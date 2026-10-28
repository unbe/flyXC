import { clampToCylinder } from '@flyxc/common';

import type { Cylinder } from '../redux/planner-slice';

export interface TurnpointHandle {
  setMap(map: google.maps.Map | null): void;
  setPosition(position: google.maps.LatLng): void;
  setCylinder(cylinder: Cylinder): void;
}

export function createTurnpointHandle(
  map: google.maps.Map,
  position: google.maps.LatLng,
  cylinder: Cylinder,
  onMove: (latLng: google.maps.LatLng) => void,
  onEnd: (latLng: google.maps.LatLng) => void,
): TurnpointHandle {
  class TurnpointHandleOverlay extends google.maps.OverlayView implements TurnpointHandle {
    private div?: HTMLDivElement;
    private position: google.maps.LatLng;
    private cylinder: Cylinder;
    private pointerId?: number;
    private startClientX = 0;
    private startClientY = 0;
    private startDivPixel: google.maps.Point | null = null;

    constructor(initPos: google.maps.LatLng, initCylinder: Cylinder) {
      super();
      this.position = initPos;
      this.cylinder = initCylinder;
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
        this.startClientX = e.clientX;
        this.startClientY = e.clientY;
        this.startDivPixel = this.getProjection()?.fromLatLngToDivPixel(this.position) ?? null;
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
        const clamped = clampToCylinder({ lat: rawLatLng.lat(), lon: rawLatLng.lng() }, this.cylinder);
        const clampedLatLng = new google.maps.LatLng(clamped.lat, clamped.lon);
        this.setPosition(clampedLatLng);
        onMove(clampedLatLng);
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
        this.pointerId = undefined;
        this.startDivPixel = null;
        div.style.opacity = '0.8';
        onEnd(this.position);
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

    setCylinder(cylinder: Cylinder): void {
      this.cylinder = cylinder;
    }
  }

  return new TurnpointHandleOverlay(position, cylinder);
}
