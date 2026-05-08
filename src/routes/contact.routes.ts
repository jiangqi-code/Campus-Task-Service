import { Router } from "express";
import { contactPublisher } from "../controllers/contact.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/:orderId/contact", requireAuth, contactPublisher);

export default router;
