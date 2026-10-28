import * as utm from 'utm';

import * as protos from '../protos/track';

// Adapted from https://github.com/ToninoTarsi/task-creator,
// which is in turn a fork of https://github.com/julien66/task-creator

type Point = {
  x: number;
  y: number;
  fx: number;
  fy: number;
  radius: number;
  fixed?: boolean;
};

function createPoint(x: number, y: number, radius = 0): Point {
  return { x, y, radius, fx: x, fy: y };
}
function createPointFromCenter(point: Point): Point {
  return createPoint(point.x, point.y, point.radius);
}
function createPointFromFix(point: Point): Point {
  return createPoint(point.fx, point.fy, point.radius);
}

// Inputs:
// points - array of point objects
// index - index of the target cylinder (from 1 upwards)
// esIndex - index of the ESS point, or -1
function getTargetPoints(points: Point[], index: number, esIndex: number): [Point, Point, Point] {
  // Set point C to the target cylinder
  const c = points[index];
  // Create point A using the fix from the previous point
  const a = createPointFromFix(points[index - 1]);
  // Create point B using the fix from the next point
  // (use point C center for the lastPoint and esIndex).
  let b: Point;
  if (index == points.length - 1 || index == esIndex) {
    b = createPointFromCenter(c);
  } else {
    b = createPointFromFix(points[index + 1]);
  }
  return [c, a, b];
}

// Inputs:
// c, a, b - target cylinder, previous point, next point
function getRelativeDistances(
  c: Point,
  a: Point,
  b: Point,
): [distAC: number, distBC: number, distAB: number, distCtoAB: number] {
  // Calculate distances AC, BC and AB
  const distAC = Math.hypot(a.x - c.x, a.y - c.y);
  const distBC = Math.hypot(b.x - c.x, b.y - c.y);
  const len2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const distAB = Math.sqrt(len2);
  let distCtoAB: number;
  // Find the shortest distance from C to the AB line segment
  if (len2 == 0.0) {
    // A and B are the same point
    distCtoAB = distAC;
  } else {
    const t = ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / len2;
    if (t < 0.0) {
      // Beyond the A end of the AB segment
      distCtoAB = distAC;
    } else if (t > 1.0) {
      // Beyond the B end of the AB segment
      distCtoAB = distBC;
    } else {
      // On the AB segment
      const cpx = t * (b.x - a.x) + a.x;
      const cpy = t * (b.y - a.y) + a.y;
      distCtoAB = Math.hypot(cpx - c.x, cpy - c.y);
    }
  }
  return [distAC, distBC, distAB, distCtoAB];
}

// Inputs:
// c, a, b - target cylinder, previous point, next point
// distAB - AB line segment length
function getIntersectionPoints(c: Point, a: Point, b: Point, distAB: number): [s1: Point, s2: Point, midpoint: Point] {
  // Find e, which is on the AB line perpendicular to c center
  const dx = (b.x - a.x) / distAB;
  const dy = (b.y - a.y) / distAB;
  const t2 = dx * (c.x - a.x) + dy * (c.y - a.y);
  const ex = t2 * dx + a.x;
  const ey = t2 * dy + a.y;
  // Calculate the intersection points, s1 and s2
  const dt2 = c.radius ** 2 - (ex - c.x) ** 2 - (ey - c.y) ** 2;
  const dt = dt2 > 0 ? Math.sqrt(dt2) : 0;
  const s1x = (t2 - dt) * dx + a.x;
  const s1y = (t2 - dt) * dy + a.y;
  const s2x = (t2 + dt) * dx + a.x;
  const s2y = (t2 + dt) * dy + a.y;
  return [createPoint(s1x, s1y), createPoint(s2x, s2y), createPoint(ex, ey)];
}

// Inputs:
// c, a, b - target cylinder, previous point, next point
// distAB - AB line segment length
function setIntersection1(c: Point, a: Point, b: Point, distAB: number) {
  // Get the intersection points (s1, s2)
  const [s1, s2, _e] = getIntersectionPoints(c, a, b, distAB);
  const as1 = Math.hypot(a.x - s1.x, a.y - s1.y);
  const bs1 = Math.hypot(b.x - s1.x, b.y - s1.y);
  // Find the intersection lying between points a and b
  if (Math.abs(as1 + bs1 - distAB) < 0.0001) {
    c.fx = s1.x;
    c.fy = s1.y;
  } else {
    c.fx = s2.x;
    c.fy = s2.y;
  }
}

// Inputs:
// c, a, b - target cylinder, previous point, next point
// distAB - AB line segment length
function setIntersection2(c: Point, a: Point, b: Point, distAB: number) {
  // Get the intersection points (s1, s2) and midpoint (e)
  const [s1, s2, e] = getIntersectionPoints(c, a, b, distAB);
  const as1 = Math.hypot(a.x - s1.x, a.y - s1.y);
  const es1 = Math.hypot(e.x - s1.x, e.y - s1.y);
  const ae = Math.hypot(a.x - e.x, a.y - e.y);
  // Find the intersection between points a and e
  if (Math.abs(as1 + es1 - ae) < 0.0001) {
    c.fx = s1.x;
    c.fy = s1.y;
  } else {
    c.fx = s2.x;
    c.fy = s2.y;
  }
}

// Inputs:
// c, a, b - target circle, previous point, next point
function setReflection(c: Point, a: Point, b: Point) {
  // The lengths of the adjacent triangle sides (af, bf) are
  // proportional to the lengths of the cut AB segments (ak, bk)
  const af = Math.hypot(a.x - c.fx, a.y - c.fy);
  const bf = Math.hypot(b.x - c.fx, b.y - c.fy);
  const t = af / (af + bf);
  // Calculate point k on the AB segment
  const kx = t * (b.x - a.x) + a.x;
  const ky = t * (b.y - a.y) + a.y;
  const kc = Math.hypot(kx - c.x, ky - c.y);
  // Project k on to the radius of c
  projectOnCircle(c, kx, ky, kc);
}

// Inputs:
// c, a, b - target cylinder, previous point, next point
// Distances between the points
function pointOnCircle(
  c: Point,
  a: Point,
  b: Point,
  distAC: number,
  distBC: number,
  distAB: number,
  distCtoAB: number,
) {
  if (Math.abs(distAC - c.radius) < 0.0001) {
    // A on the circle (perhaps B as well): use A position
    c.fx = a.x;
    c.fy = a.y;
    return true;
  }
  if (Math.abs(distBC - c.radius) < 0.0001) {
    // B on the circle
    if (distCtoAB < c.radius && distAC > c.radius) {
      // AB segment intersects the circle and A is outside it
      setIntersection2(c, a, b, distAB);
    } else {
      // Use B position
      c.fx = b.x;
      c.fy = b.y;
    }
    return true;
  }
  return false;
}

// Inputs:
// c - the circle
// x, y - coordinates of the point to project
// len - line segment length, from c to the point
function projectOnCircle(c: Point, x: number, y: number, len: number) {
  if (len == 0.0) {
    // The default direction is eastwards (90 degrees)
    c.fx = c.radius + c.x;
    c.fy = c.y;
  } else {
    c.fx = (c.radius * (x - c.x)) / len + c.x;
    c.fy = (c.radius * (y - c.y)) / len + c.y;
  }
}

// Inputs:
// c, a, b - target cylinder, previous point, next point
function processCylinder(c: Point, a: Point, b: Point) {
  const [distAC, distBC, distAB, distCtoAB] = getRelativeDistances(c, a, b);
  if (distAB == 0.0) {
    // A and B are the same point: project the point on the circle
    projectOnCircle(c, a.x, a.y, distAC);
  } else if (pointOnCircle(c, a, b, distAC, distBC, distAB, distCtoAB)) {
    // A or B are on the circle: the fix has been calculated
    return;
  } else if (distCtoAB < c.radius) {
    // AB segment intersects the circle, but is not tangent to it
    if (distAC < c.radius && distBC < c.radius) {
      // A and B are inside the circle
      setReflection(c, a, b);
    } else if ((distAC < c.radius && distBC > c.radius) || (distAC > c.radius && distBC < c.radius)) {
      // One point inside, one point outside the circle
      setIntersection1(c, a, b, distAB);
    } else if (distAC > c.radius && distBC > c.radius) {
      // A and B are outside the circle
      setIntersection2(c, a, b, distAB);
    }
  } else {
    // A and B are outside the circle and the AB segment is
    // either tangent to it or does not intersect it
    setReflection(c, a, b);
  }
}

function optimizeStep(points: Point[], esIndex = -1): number {
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    // Get the target cylinder c and its preceding and succeeding points
    const [c, a, b] = getTargetPoints(points, index, esIndex);
    if (!c.fixed) {
      processCylinder(c, a, b);
    }
    // Calculate the distance from A to the C fix point
    const legDistance = Math.hypot(a.x - c.fx, a.y - c.fy);
    distance += legDistance;
  }
  return distance;
}

export function optimize(points: Point[], esIndex = -1): number {
  const tolerance = 1.0;
  let lastDistance = Number.MAX_SAFE_INTEGER;
  const count = points.length;
  // opsCount is the number of operations allowed
  let opsCount = count * 10;
  while (opsCount-- > 0) {
    const distance = optimizeStep(points, esIndex);
    // See if the difference between the last distance is
    // smaller than the tolerance
    if (Math.abs(lastDistance - distance) < tolerance) {
      break;
    }
    lastDistance = distance;
  }
  return lastDistance;
}

export function optimizeTask(points: protos.Route, esIndex = -1): protos.Route {
  const numPoints = points.centerLat.length > 0 ? points.centerLat.length : points.lat.length;
  if (numPoints === 0) {
    return protos.Route.create();
  }
  const centerLats = points.centerLat.length > 0 ? points.centerLat : points.lat;
  const centerLons = points.centerLon.length > 0 ? points.centerLon : points.lon;

  const task: Point[] = [];
  let zone: number | undefined;
  let zoneLetter: string | undefined;
  for (let i = 0; i < numPoints; i++) {
    const utmPoint = utm.fromLatLon(centerLats[i], centerLons[i], zone);
    task.push(createPoint(utmPoint.easting, utmPoint.northing, points.radius[i] ?? 0));
    zone = utmPoint.zoneNum;
    zoneLetter = utmPoint.zoneLetter;
  }
  optimize(task, esIndex);
  const r = protos.Route.create({
    alt: [...points.alt],
    centerLat: [...centerLats],
    centerLon: [...centerLons],
    radius: [...points.radius],
  });
  for (let i = 0; i < numPoints; i++) {
    const { latitude: lat, longitude: lon } = utm.toLatLon(
      task[i].fx,
      task[i].fy,
      zone as number,
      zoneLetter as string,
    );
    r.lat.push(lat);
    r.lon.push(lon);
  }
  return r;
}

export interface TaskCylinder {
  lat: number;
  lon: number;
  radius: number;
  optLat?: number;
  optLon?: number;
}

const EARTH_RADIUS = 6378137;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function sphericalDistanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return EARTH_RADIUS * c;
}

export function isPointInCylinder(
  point: { lat: number; lon: number },
  cylinder: TaskCylinder,
  toleranceM = 5,
): boolean {
  const allowance = Math.max(toleranceM, cylinder.radius * 0.002);
  return sphericalDistanceM(point, cylinder) <= cylinder.radius + allowance;
}

export function isPathConformingToTask(
  points: { lat: number; lon: number }[],
  cylinders: TaskCylinder[],
): boolean {
  if (points.length < 2) {
    return false;
  }
  if (cylinders.length === 0) {
    return true;
  }
  let cylIdx = 0;
  for (const pt of points) {
    if (isPointInCylinder(pt, cylinders[cylIdx])) {
      cylIdx++;
      if (cylIdx === cylinders.length) {
        return true;
      }
    }
  }
  return false;
}

// Returns the cylinder index that `points[vertexIndex]` must stay inside to keep the path
// conforming to `cylinders`, or `null` if removing `points[vertexIndex]` still leaves the
// path conforming to `cylinders`.
export function getRequiredCylinderIndex(
  points: { lat: number; lon: number }[],
  vertexIndex: number,
  cylinders: TaskCylinder[],
): number | null {
  if (cylinders.length === 0 || vertexIndex < 0 || vertexIndex >= points.length) {
    return null;
  }
  let prefixCyl = 0;
  for (let i = 0; i < vertexIndex && prefixCyl < cylinders.length; i++) {
    if (isPointInCylinder(points[i], cylinders[prefixCyl])) {
      prefixCyl++;
    }
  }
  let suffixCyl = cylinders.length - 1;
  for (let i = points.length - 1; i > vertexIndex && suffixCyl >= 0; i--) {
    if (isPointInCylinder(points[i], cylinders[suffixCyl])) {
      suffixCyl--;
    }
  }
  if (prefixCyl > suffixCyl) {
    return null;
  }
  return prefixCyl;
}

// Re-optimizes any cylinder turnpoints that are not in `manuallyMovedCylinders`,
// keeping manually moved cylinder turnpoints and extra waypoints fixed at their current locations.
export function reoptimizeTaskPoints(
  points: { lat: number; lon: number }[],
  cylinders: TaskCylinder[],
  manuallyMovedCylinders: ReadonlySet<number>,
  esIndex = -1,
): { lat: number; lon: number }[] {
  if (points.length === 0 || cylinders.length === 0) {
    return points;
  }

  const task: Point[] = [];
  let zone: number | undefined;
  let zoneLetter: string | undefined;

  for (let i = 0; i < points.length; i++) {
    const reqCylIdx = getRequiredCylinderIndex(points, i, cylinders);
    if (reqCylIdx !== null && !manuallyMovedCylinders.has(reqCylIdx)) {
      const cyl = cylinders[reqCylIdx];
      const utmCenter = utm.fromLatLon(cyl.lat, cyl.lon, zone);
      task.push({
        x: utmCenter.easting,
        y: utmCenter.northing,
        fx: utmCenter.easting,
        fy: utmCenter.northing,
        radius: cyl.radius,
        fixed: false,
      });
      zone = utmCenter.zoneNum;
      zoneLetter = utmCenter.zoneLetter;
    } else {
      const utmPt = utm.fromLatLon(points[i].lat, points[i].lon, zone);
      task.push({
        x: utmPt.easting,
        y: utmPt.northing,
        fx: utmPt.easting,
        fy: utmPt.northing,
        radius: 0,
        fixed: true,
      });
      zone = utmPt.zoneNum;
      zoneLetter = utmPt.zoneLetter;
    }
  }

  optimize(task, esIndex);

  return points.map((pt, i) => {
    if (task[i].fixed) {
      return pt;
    }
    const { latitude: lat, longitude: lon } = utm.toLatLon(
      task[i].fx,
      task[i].fy,
      zone as number,
      zoneLetter as string,
    );
    return { lat, lon };
  });
}

// Clamps a point so that it lies on or within the given cylinder.
export function clampToCylinder(
  point: { lat: number; lon: number },
  cylinder: { lat: number; lon: number; radius: number },
): { lat: number; lon: number } {
  if (cylinder.radius <= 0) {
    return { lat: cylinder.lat, lon: cylinder.lon };
  }
  const distance = sphericalDistanceM(cylinder, point);

  if (distance <= cylinder.radius) {
    return { lat: point.lat, lon: point.lon };
  }

  const lat1 = toRad(cylinder.lat);
  const lon1 = toRad(cylinder.lon);
  const lat2 = toRad(point.lat);
  const lon2 = toRad(point.lon);
  const dLon = lon2 - lon1;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = Math.atan2(y, x);
  const angularDistance = cylinder.radius / EARTH_RADIUS;

  const sinLat3 =
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing);
  const lat3 = Math.asin(Math.max(-1, Math.min(1, sinLat3)));
  const lon3 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat3),
    );

  return { lat: toDeg(lat3), lon: toDeg(lon3) };
}
