import { resolveAmapKey } from "./systemConfig.service";

export class MapError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type DistanceInput = {
  originLat: unknown;
  originLng: unknown;
  destinationLat: unknown;
  destinationLng: unknown;
};

const normalizeCoordinate = (value: unknown, name: string) => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new MapError(400, `${name} 不合法`);
  }

  return parsed;
};

export class MapService {
  async getDistance(input: DistanceInput) {
    const originLat = normalizeCoordinate(input.originLat, "originLat");
    const originLng = normalizeCoordinate(input.originLng, "originLng");
    const destinationLat = normalizeCoordinate(input.destinationLat, "destinationLat");
    const destinationLng = normalizeCoordinate(input.destinationLng, "destinationLng");

    // 直接使用 campus_server 的 Key
    const key = "77919600cfaec32a002660dc67869bb2";

    const search = new URLSearchParams({
      key,
      origins: `${originLng},${originLat}`,
      destination: `${destinationLng},${destinationLat}`,
      type: "0",
    });
    const response = await fetch(`https://restapi.amap.com/v3/distance?${search.toString()}`).catch(
      () => {
        throw new MapError(502, "调用高德地图失败");
      },
    );

    if (!response.ok) {
      throw new MapError(502, "高德地图服务不可用");
    }

    const payload = (await response.json().catch(() => null)) as
      | {
        status?: string;
        info?: string;
        infocode?: string;
        results?: Array<{ distance?: string; duration?: string }>;
      }
      | null;

    if (!payload || payload.status !== "1") {
      throw new MapError(
        502,
        payload?.info ? `高德地图返回失败: ${payload.info}` : "高德地图返回失败",
      );
    }

    const first = payload.results?.[0];
    const distanceMeters = first?.distance ? Number(first.distance) : Number.NaN;
    const durationSeconds = first?.duration ? Number(first.duration) : Number.NaN;

    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
      throw new MapError(502, "高德地图距离结果不合法");
    }

    return {
      distance_meters: Math.round(distanceMeters),
      distance_km: Number((distanceMeters / 1000).toFixed(2)),
      duration_seconds:
        Number.isFinite(durationSeconds) && durationSeconds >= 0
          ? Math.round(durationSeconds)
          : null,
    };
  }
}
