import type { RequestHandler } from "express";
import { MapError, MapService } from "../services/map.service";

const mapService = new MapService();

export const getDistance: RequestHandler = async (req, res, next) => {
  try {
    const {
      origin_lat,
      origin_lng,
      destination_lat,
      destination_lng,
      pickup_lat,
      pickup_lng,
      delivery_lat,
      delivery_lng,
    } = req.body as Partial<Record<string, unknown>>;

    const result = await mapService.getDistance({
      originLat: (origin_lat ?? pickup_lat) as string | number,
      originLng: (origin_lng ?? pickup_lng) as string | number,
      destinationLat: (destination_lat ?? delivery_lat) as string | number,
      destinationLng: (destination_lng ?? delivery_lng) as string | number,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof MapError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
