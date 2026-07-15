import { Router } from "express";
import { getPublicConfig } from "../controllers/config.controller";

const router = Router();

router.get("/public", getPublicConfig);

export default router;
