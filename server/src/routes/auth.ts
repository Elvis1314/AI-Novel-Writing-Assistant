import { Router } from "express";
import { loginHandler } from "../middleware/auth";

const router = Router();

router.post("/login", loginHandler);

export default router;
