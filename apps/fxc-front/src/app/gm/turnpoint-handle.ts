import { clampToCylinder } from '@flyxc/common';

import type { Cylinder } from '../redux/planner-slice';

export interface TurnpointHandle {
  setMap(map: google.maps.Map | null): void;
  setPosition(position: google.maps.LatLng): void;
}

export interface MidpointHandle {
  setMap(map: google.maps.Map | null): void;
  setEndpoints(pos1: google.maps.LatLng, pos2: google.maps.LatLng): void;
}

export function createTurnpointHandle(
  map: google.maps.Map,
  position: google.maps.LatLng,
  getCylinder: () => Cylinder | null,
  onMove: (latLng: google.maps.LatLng) => void,
  onEnd: (latLng: google.maps.LatLng) => void,
  onDelete: () => void,
): TurnpointHandle {
  class TurnpointHandleOverlay extends google.maps.OverlayView implements TurnpointHandle {
    private div?: HTMLDivElement;
    private position: google.maps.LatLng;
    private activeCylinder: Cylinder | null = null;
    private pointerId?: number;
    private startClientX = 0;
    private startClientY = 0;
    private startDivPixel: google.maps.Point | null = null;
    private hasMoved = false;

    constructor(initPos: google.maps.LatLng) {
      super();
      this.position = initPos;
      this.setMap(map);
    }

    override onAdd(): void {
      const div = document.createElement('div');
      Object.assign(div.style, {
        position: 'absolute',
        width: '11px',
        height: '11px',
        boxSizing: 'border-box',
        border: '1px solid black',
        borderRadius: '6px',
        backgroundColor: 'white',
        opacity: '0.8',
        cursor: 'pointer',
        touchAction: 'none',
        transform: 'translate(-50%, -50%)',
        zIndex: '200',
      });

      div.addEventListener('pointerenter', () => {
        div.style.opacity = '1';
      });
      div.addEventListener('pointerleave', () => {
        if (this.pointerId === undefined) {
          div.style.opacity = '0.8';
        }
      });

      div.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0 && e.pointerType === 'mouse') {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        div.setPointerCapture(e.pointerId);
        div.style.opacity = '1';
        this.pointerId = e.pointerId;
        this.hasMoved = false;
        this.startClientX = e.clientX;
        this.startClientY = e.clientY;
        this.startDivPixel = this.getProjection()?.fromLatLngToDivPixel(this.position) ?? null;
        this.activeCylinder = getCylinder();
      });

      div.addEventListener('pointermove', (e: PointerEvent) => {
        if (this.pointerId !== e.pointerId || !this.startDivPixel) {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        const proj = this.getProjection();
        if (!proj) {
          return;
        }
        this.hasMoved = true;
        const cursorPixel = new google.maps.Point(
          this.startDivPixel.x + (e.clientX - this.startClientX),
          this.startDivPixel.y + (e.clientY - this.startClientY),
        );
        const rawLatLng = proj.fromDivPixelToLatLng(cursorPixel);
        if (!rawLatLng) {
          return;
        }
        const nextLatLng = this.activeCylinder
          ? (() => {
              const clamped = clampToCylinder({ lat: rawLatLng.lat(), lon: rawLatLng.lng() }, this.activeCylinder);
              return new google.maps.LatLng(clamped.lat, clamped.lon);
            })()
          : rawLatLng;
        this.setPosition(nextLatLng);
        onMove(nextLatLng);
      });

      const finishDrag = (e: PointerEvent) => {
        if (this.pointerId !== e.pointerId) {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        if (div.hasPointerCapture(e.pointerId)) {
          div.releasePointerCapture(e.pointerId);
        }
        const didMove = this.hasMoved;
        this.pointerId = undefined;
        this.startDivPixel = null;
        this.hasMoved = false;
        div.style.opacity = '0.8';
        if (didMove) {
          onEnd(this.position);
        }
      };

      div.addEventListener('pointerup', finishDrag);
      div.addEventListener('pointercancel', finishDrag);

      div.addEventListener('contextmenu', (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onDelete();
      });

      div.addEventListener('dblclick', (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onDelete();
      });

      for (const evt of ['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'click']) {
        div.addEventListener(evt, (e) => e.stopPropagation());
      }

      this.div = div;
      this.getPanes()?.overlayMouseTarget.appendChild(div);
    }

    override draw(): void {
      const point = this.getProjection()?.fromLatLngToDivPixel(this.position);
      if (point && this.div) {
        this.div.style.left = `${point.x}px`;
        this.div.style.top = `${point.y}px`;
      }
    }

    override onRemove(): void {
      this.div?.remove();
      this.div = undefined;
    }

    setPosition(position: google.maps.LatLng): void {
      this.position = position;
      this.draw();
    }
  }

  return new TurnpointHandleOverlay(position);
}

export function createMidpointHandle(
  map: google.maps.Map,
  pos1: google.maps.LatLng,
  pos2: google.maps.LatLng,
  onStartInsert: (latLng: google.maps.LatLng) => void,
  onMove: (latLng: google.maps.LatLng) => void,
  onEnd: (latLng: google.maps.LatLng) => void,
): MidpointHandle {
  class MidpointHandleOverlay extends google.maps.OverlayView implements MidpointHandle {
    private div?: HTMLDivElement;
    private pos1: google.maps.LatLng;
    private pos2: google.maps.LatLng;
    private draggedPos: google.maps.LatLng | null = null;
    private pointerId?: number;
    private startClientX = 0;
    private startClientY = 0;
    private startDivPixel: google.maps.Point | null = null;
    private inserted = false;

    constructor(initPos1: google.maps.LatLng, initPos2: google.maps.LatLng) {
      super();
      this.pos1 = initPos1;
      this.pos2 = initPos2;
      this.setMap(map);
    }

    override onAdd(): void {
      const div = document.createElement('div');
      Object.assign(div.style, {
        position: 'absolute',
        width: '11px',
        height: '11px',
        boxSizing: 'border-box',
        border: '1px solid black',
        borderRadius: '6px',
        backgroundColor: 'white',
        opacity: '0.5',
        cursor: 'pointer',
        touchAction: 'none',
        transform: 'translate(-50%, -50%)',
        zIndex: '190',
      });

      div.addEventListener('pointerenter', () => {
        div.style.opacity = '0.9';
      });
      div.addEventListener('pointerleave', () => {
        if (this.pointerId === undefined) {
          div.style.opacity = '0.5';
        }
      });

      div.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0 && e.pointerType === 'mouse') {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        div.setPointerCapture(e.pointerId);
        div.style.opacity = '1';
        this.pointerId = e.pointerId;
        this.inserted = false;
        this.startClientX = e.clientX;
        this.startClientY = e.clientY;
        const proj = this.getProjection();
        const p1 = proj?.fromLatLngToDivPixel(this.pos1);
        const p2 = proj?.fromLatLngToDivPixel(this.pos2);
        this.startDivPixel = p1 && p2 ? new google.maps.Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2) : null;
      });

      div.addEventListener('pointermove', (e: PointerEvent) => {
        if (this.pointerId !== e.pointerId || !this.startDivPixel) {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        const proj = this.getProjection();
        if (!proj) {
          return;
        }
        const cursorPixel = new google.maps.Point(
          this.startDivPixel.x + (e.clientX - this.startClientX),
          this.startDivPixel.y + (e.clientY - this.startClientY),
        );
        const rawLatLng = proj.fromDivPixelToLatLng(cursorPixel);
        if (!rawLatLng) {
          return;
        }
        this.draggedPos = rawLatLng;
        this.draw();
        if (!this.inserted) {
          this.inserted = true;
          onStartInsert(rawLatLng);
        } else {
          onMove(rawLatLng);
        }
      });

      const finishDrag = (e: PointerEvent) => {
        if (this.pointerId !== e.pointerId) {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        if (div.hasPointerCapture(e.pointerId)) {
          div.releasePointerCapture(e.pointerId);
        }
        const wasInserted = this.inserted;
        const finalPos = this.draggedPos;
        this.pointerId = undefined;
        this.startDivPixel = null;
        this.inserted = false;
        this.draggedPos = null;
        div.style.opacity = '0.5';
        if (wasInserted && finalPos) {
          onEnd(finalPos);
        }
      };

      div.addEventListener('pointerup', finishDrag);
      div.addEventListener('pointercancel', finishDrag);

      for (const evt of ['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'click', 'dblclick', 'contextmenu']) {
        div.addEventListener(evt, (e) => e.stopPropagation());
      }

      this.div = div;
      this.getPanes()?.overlayMouseTarget.appendChild(div);
    }

    override draw(): void {
      const proj = this.getProjection();
      if (!proj || !this.div) {
        return;
      }
      if (this.draggedPos) {
        const pt = proj.fromLatLngToDivPixel(this.draggedPos);
        if (pt) {
          this.div.style.left = `${pt.x}px`;
          this.div.style.top = `${pt.y}px`;
        }
        return;
      }
      const p1 = proj.fromLatLngToDivPixel(this.pos1);
      const p2 = proj.fromLatLngToDivPixel(this.pos2);
      if (p1 && p2) {
        this.div.style.left = `${(p1.x + p2.x) / 2}px`;
        this.div.style.top = `${(p1.y + p2.y) / 2}px`;
      }
    }

    override onRemove(): void {
      this.div?.remove();
      this.div = undefined;
    }

    setEndpoints(pos1: google.maps.LatLng, pos2: google.maps.LatLng): void {
      this.pos1 = pos1;
      this.pos2 = pos2;
      this.draw();
    }
  }

  return new MidpointHandleOverlay(pos1, pos2);
}
