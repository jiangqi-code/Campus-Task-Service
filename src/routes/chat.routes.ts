import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { messages, send } from "../controllers/chat.controller";

const router = Router();

router.post("/send", requireAuth, send);
router.get("/messages", requireAuth, messages);

export default router;

