import { parse } from './xctsk';

describe('Parse XCTSk files', () => {
  describe('Invalid', () => {
    test('type', () => {
      expect(
        parse(`{
      "taskType": "CLaSSIC",
      "version": 1,
      "turnpoints": [
        {
          "radius": 400,
          "waypoint": {
            "name": "FXC001",
            "lat": 1.1,
            "lon": -1.1,
            "altSmoothed": 3
          }
        },
        {
          "radius": 400,
          "waypoint": {
            "name": "FXC002",
            "lat": 2.2,
            "lon": -2.2,
            "altSmoothed": 0
          }
        }
      ]
    }`),
      ).toBe(null);
    });

    test('version', () => {
      expect(
        parse(`{
    "taskType": "CLASSIC",
    "version": 2,
    "turnpoints": [
      {
        "radius": 400,
        "waypoint": {
          "name": "FXC001",
          "lat": "1.1",
          "lon": -1.1,
          "altSmoothed": 3
        }
      },
      {
        "radius": 400,
        "waypoint": {
          "name": "FXC002",
          "lat": "2.2",
          "lon": -2.2,
          "altSmoothed": 0
        }
      }
    ]
  }`),
      ).toBe(null);
    });

    test('turnpoints', () => {
      expect(
        parse(`{
      "taskType": "CLASSIC",
      "version": 1,
    }`),
      ).toBe(null);
    });
  });

  describe('Valid', () => {
    test('route', () => {
      const route = parse(`{
        "taskType": "CLASSIC",
        "version": 1,
        "turnpoints": [
          {
            "radius": 400,
            "waypoint": {
              "name": "FXC001",
              "lat": 1.1,
              "lon": -1.1,
              "altSmoothed": 3
            }
          },
          {
            "radius": 400,
            "waypoint": {
              "name": "FXC002",
              "lat": 2.2,
              "lon": -2.2,
              "altSmoothed": 0
            }
          }
        ]
      }`);
      expect(route).not.toBeNull();
      expect(route?.alt).toEqual([3, 0]);
      expect(route?.centerLat).toEqual([1.1, 2.2]);
      expect(route?.centerLon).toEqual([-1.1, -2.2]);
      expect(route?.radius).toEqual([400, 400]);
      expect(route?.lat[0]).toBeCloseTo(1.1, 5);
      expect(route?.lon[0]).toBeCloseTo(-1.1, 5);
      expect(route?.lat[1]).toBeCloseTo(2.19745, 5);
      expect(route?.lon[1]).toBeCloseTo(-2.19745, 5);
    });
  });
});
