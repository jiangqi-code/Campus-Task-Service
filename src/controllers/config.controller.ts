import type { RequestHandler } from "express";
import { getDeliveryPricingConfig } from "../services/systemConfig.service";

export const getPublicConfig: RequestHandler = async (_req, res, next) => {
  try {
    const config = await getDeliveryPricingConfig();
    res.status(200).json(config);
  } catch (err) {
    next(err);
  }
};
