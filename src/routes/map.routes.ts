import { Router } from "express";
import { getDistance } from "../controllers/map.controller";

const router = Router();

router.post("/distance", getDistance);

export default router;
