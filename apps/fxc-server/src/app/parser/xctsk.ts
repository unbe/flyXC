// https://xctrack.org/Competition_Interfaces.html

import { optimizeTask, protos } from '@flyxc/common';

export function parse(content: string): protos.Route | null {
  let json;
  try {
    json = JSON.parse(content);
  } catch (e) {
    return null;
  }

  if (json.taskType !== 'CLASSIC') {
    return null;
  }

  if (json.version !== 1) {
    return null;
  }

  if (!Array.isArray(json.turnpoints) || json.turnpoints.length < 2) {
    return null;
  }

  const route = protos.Route.create();

  json.turnpoints.forEach((tp: any) => {
    const lat = Number(tp.waypoint?.lat ?? 0);
    const lon = Number(tp.waypoint?.lon ?? 0);
    route.lat.push(lat);
    route.lon.push(lon);
    route.alt.push(Number(tp.waypoint?.altSmoothed ?? 0));
    route.centerLat.push(lat);
    route.centerLon.push(lon);
    route.radius.push(Number(tp.radius ?? 0));
  });

  return optimizeTask(route);
}
