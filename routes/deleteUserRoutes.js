const { Router } = require("express")
const { deleteUser, activateUser, suspendUser } = require("../controllers/deleteUserControllers")
const checkRole = require("../middlewares/roleCheck")
const router = Router()

/**
 * @swagger
 * /deleteUser:
 *   delete:
 *     summary: Delete user account
 *     tags: [User]
 *     responses:
 *       200:
 *         description: User deleted successfully
 */


router.delete("/", deleteUser)

router.post("/activate", checkRole(["superadmin"]), activateUser)

router.post("/suspend", checkRole(["superadmin"]), suspendUser)


module.exports = router