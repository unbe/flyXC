import { getDistance } from 'geolib';

import * as protos from '../protos/track';
import { clampToCylinder, optimizeTask } from './tasks';

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
});
