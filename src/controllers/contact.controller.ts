import type { RequestHandler } from "express";
import { Role } from "@prisma/client";
import { ContactError, contactService } from "../services/contact.service";

export const contactPublisher: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.role !== Role.RUNNER) {
      res.status(403).json({ error: "无权限" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const result = await contactService.contactPublisher({ orderId, runnerId: user.id });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof ContactError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
