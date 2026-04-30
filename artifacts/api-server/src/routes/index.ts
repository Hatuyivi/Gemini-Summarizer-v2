import { Router, type IRouter } from "express";
import healthRouter from "./health";
import summarizeRouter from "./summarize";

const router: IRouter = Router();

router.use(healthRouter);
router.use(summarizeRouter);

export default router;
