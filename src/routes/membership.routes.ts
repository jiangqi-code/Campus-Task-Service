import { Router } from "express";
import { acceptInvite, getInviteRanking, getMembership } from "../controllers/membership.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.get("/", requireAuth, getMembership);
router.post("/invite", requireAuth, acceptInvite);
router.get("/ranking", requireAuth, getInviteRanking);
export default router;
