import { getDistance } from 'geolib';

import * as protos from '../protos/track';
import {
  clampToCylinder,
  getRequiredCylinderIndex,
  isPathConformingToTask,
  optimizeTask,
  reoptimizeTaskPoints,
} from './tasks';

describe('tasks', () => {
  describe('clampToCylinder', () => {
    const cylinder = { lat: 46.65707, lon: 8.0553, radius: 1000 };

    test('returns point unchanged when inside the cylinder', () => {
      const insidePoint = { lat: 46.658, lon: 8.056 };
      expect(getDistance(cylinder, insidePoint)).toBeLessThan(cylinder.radius);
      const res = clampToCylinder(insidePoint, cylinder);
      expect(res).toEqual(insidePoint);
    });

    test('returns center when cylinder radius is 0', () => {
      const zeroCylinder = { lat: 46.65707, lon: 8.0553, radius: 0 };
      const point = { lat: 46.7, lon: 8.1 };
      const res = clampToCylinder(point, zeroCylinder);
      expect(res).toEqual({ lat: zeroCylinder.lat, lon: zeroCylinder.lon });
    });

    test('clamps point outside cylinder to the perimeter along the same bearing', () => {
      // Point ~5km north of center
      const outsideNorth = { lat: 46.70707, lon: 8.0553 };
      const res = clampToCylinder(outsideNorth, cylinder);
      expect(res.lon).toBeCloseTo(cylinder.lon, 5);
      expect(res.lat).toBeGreaterThan(cylinder.lat);
      expect(res.lat).toBeLessThan(outsideNorth.lat);
      expect(getDistance(cylinder, res)).toBeCloseTo(cylinder.radius, -1);

      // Re-clamping the clamped point leaves it unchanged
      const reClamped = clampToCylinder(res, cylinder);
      expect(reClamped.lat).toBeCloseTo(res.lat, 8);
      expect(reClamped.lon).toBeCloseTo(res.lon, 8);
    });
  });

  describe('optimizeTask', () => {
    test('optimizes route points onto cylinder perimeters', () => {
      const route = protos.Route.create({
        lat: [46.65707, 46.57578, 46.65437],
        lon: [8.0553, 7.93825, 8.104],
        alt: [0, 0, 0],
        centerLat: [46.65707, 46.57578, 46.65437],
        centerLon: [8.0553, 7.93825, 8.104],
        radius: [400, 4800, 1000],
      });
      const optimized = optimizeTask(route);
      expect(optimized.lat).toHaveLength(3);
      expect(optimized.lon).toHaveLength(3);
      expect(optimized.centerLat).toEqual(route.centerLat);
      expect(optimized.centerLon).toEqual(route.centerLon);
      expect(optimized.radius).toEqual(route.radius);

      // Turnpoint 1 and 2 should sit near their cylinder perimeters
      const d1 = getDistance(
        { lat: optimized.centerLat[1], lon: optimized.centerLon[1] },
        { lat: optimized.lat[1], lon: optimized.lon[1] },
      );
      const d2 = getDistance(
        { lat: optimized.centerLat[2], lon: optimized.centerLon[2] },
        { lat: optimized.lat[2], lon: optimized.lon[2] },
      );
      expect(Math.abs(d1 - 4800)).toBeLessThan(20);
      expect(Math.abs(d2 - 1000)).toBeLessThan(10);
    });
  });

  describe('isPathConformingToTask & getRequiredCylinderIndex', () => {
    const cylinders = [
      { lat: 46.65707, lon: 8.0553, radius: 400 },
      { lat: 46.57578, lon: 7.93825, radius: 4800 },
      { lat: 46.65437, lon: 8.104, radius: 1000 },
    ];

    test('identifies required cylinders when path has exact task turnpoints', () => {
      const points = cylinders.map((c) => ({ lat: c.lat, lon: c.lon }));
      expect(isPathConformingToTask(points, cylinders)).toBe(true);
      expect(getRequiredCylinderIndex(points, 0, cylinders)).toBe(0);
      expect(getRequiredCylinderIndex(points, 1, cylinders)).toBe(1);
      expect(getRequiredCylinderIndex(points, 2, cylinders)).toBe(2);
    });

    test('allows deleting extra intermediate points while keeping cylinder points required', () => {
      const points = [
        { lat: cylinders[0].lat, lon: cylinders[0].lon },
        { lat: 46.62, lon: 8.0 }, // intermediate point outside cylinders
        { lat: cylinders[1].lat, lon: cylinders[1].lon },
        { lat: cylinders[2].lat, lon: cylinders[2].lon },
      ];
      expect(isPathConformingToTask(points, cylinders)).toBe(true);
      expect(getRequiredCylinderIndex(points, 0, cylinders)).toBe(0);
      expect(getRequiredCylinderIndex(points, 1, cylinders)).toBeNull();
      expect(getRequiredCylinderIndex(points, 2, cylinders)).toBe(1);
      expect(getRequiredCylinderIndex(points, 3, cylinders)).toBe(2);
    });

    test('allows deleting one of two points inside the same cylinder', () => {
      const points = [
        { lat: cylinders[0].lat, lon: cylinders[0].lon },
        { lat: cylinders[1].lat, lon: cylinders[1].lon },
        { lat: cylinders[1].lat + 0.001, lon: cylinders[1].lon }, // second point inside cylinder 1
        { lat: cylinders[2].lat, lon: cylinders[2].lon },
      ];
      expect(isPathConformingToTask(points, cylinders)).toBe(true);
      expect(getRequiredCylinderIndex(points, 1, cylinders)).toBeNull();
      expect(getRequiredCylinderIndex(points, 2, cylinders)).toBeNull();
    });

    test('reoptimizeTaskPoints updates unmoved cylinders when a point is moved and when reset', () => {
      const initialPoints = reoptimizeTaskPoints(
        cylinders.map((c) => ({ lat: c.lat, lon: c.lon })),
        cylinders,
        new Set(),
      );

      // Move cylinder 2 point manually to the southern edge of cylinder 2
      const movedPt2 = clampToCylinder({ lat: cylinders[2].lat - 0.02, lon: cylinders[2].lon }, cylinders[2]);
      const pointsAfterMove = [initialPoints[0], initialPoints[1], movedPt2];
      const reoptimized = reoptimizeTaskPoints(pointsAfterMove, cylinders, new Set([2]));

      // Point 2 stays fixed at movedPt2, while point 1 (unmoved) adjusts to a new optimized position
      expect(reoptimized[2]).toEqual(movedPt2);
      expect(reoptimized[1]).not.toEqual(initialPoints[1]);

      // When point 2 is "deleted" (removed from manuallyMovedCylinders), all points snap back to initialPoints
      const resetPoints = reoptimizeTaskPoints(reoptimized, cylinders, new Set());
      expect(resetPoints[1].lat).toBeCloseTo(initialPoints[1].lat, 5);
      expect(resetPoints[1].lon).toBeCloseTo(initialPoints[1].lon, 5);
      expect(resetPoints[2].lat).toBeCloseTo(initialPoints[2].lat, 5);
      expect(resetPoints[2].lon).toBeCloseTo(initialPoints[2].lon, 5);
    });
  });
});
