const { Router } = require("express");
const {
  getDefaultPlan,
  getStarterPlan,
  getProPlan,
  setupInitialPlan,
  validateAndUpdatePlanStatus,
} = require("../utils/planUtils");
const { checkForAuthentication } = require("../middlewares/authentication");

const router = Router();

/**
 * @swagger
 * /test/plan-utils:
 *   get:
 *     summary: Test plan utilities
 *     tags: [Test]
 *     responses:
 *       200:
 *         description: Plan utilities test results
 */

router.get("/plan-utils", async (req, res) => {
  try {
    const defaultPlan = await getDefaultPlan();
    const starterPlan = await getStarterPlan();
    const proPlan = await getProPlan();
    const initialPlanData = await setupInitialPlan();

    return res.json({
      status: "success",
      message: "Plan utilities test completed",
      data: {
        defaultPlan: defaultPlan
          ? { name: defaultPlan.name, _id: defaultPlan._id }
          : null,
        starterPlan: starterPlan
          ? { name: starterPlan.name, _id: starterPlan._id }
          : null,
        proPlan: proPlan ? { name: proPlan.name, _id: proPlan._id } : null,
        initialPlanData,
      },
    });
  } catch (error) {
    console.error("Error testing plan utilities:", error);
    return res.status(500).json({
      status: "error",
      message: "Plan utilities test failed",
      error: error.message,
    });
  }
});

/**
 * @swagger
 * /test/validate-plan:
 *   post:
 *     summary: Test plan validation for current user
 *     tags: [Test]
 *     responses:
 *       200:
 *         description: Plan validation test results
 */

router.post("/validate-plan", checkForAuthentication(), async (req, res) => {
  try {
    const result = await validateAndUpdatePlanStatus(req.user._id);

    return res.json({
      status: "success",
      message: "Plan validation test completed",
      data: {
        userId: req.user._id,
        planValidationResult: result
          ? "User plan was updated"
          : "No changes needed",
      },
    });
  } catch (error) {
    console.error("Error testing plan validation:", error);
    return res.status(500).json({
      status: "error",
      message: "Plan validation test failed",
      error: error.message,
    });
  }
});

module.exports = router;
