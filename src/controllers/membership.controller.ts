import type { RequestHandler } from "express";
import { MembershipError, membershipService } from "../services/membership.service";

const handleError = (error: unknown, res: any, next: any) => {
  if (error instanceof MembershipError) return res.status(error.status).json({ error: error.message });
  next(error);
};

export const getMembership: RequestHandler = async (req, res, next) => {
  try { if (!req.user) return res.status(401).json({ error: "Unauthorized" }); res.status(200).json(await membershipService.getProfile(req.user.id)); } catch (error) { handleError(error, res, next); }
};
export const acceptInvite: RequestHandler = async (req, res, next) => {
  try { if (!req.user) return res.status(401).json({ error: "Unauthorized" }); res.status(200).json(await membershipService.acceptInvite({ userId: req.user.id, code: (req.body ?? {}).code })); } catch (error) { handleError(error, res, next); }
};
export const getInviteRanking: RequestHandler = async (_req, res, next) => {
  try { res.status(200).json({ list: await membershipService.ranking() }); } catch (error) { handleError(error, res, next); }
};
