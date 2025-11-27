const { Router } = require("express")
const { deleteUser, activateUser, suspendUser } = require("../controllers/deleteUserControllers")
const checkRole = require("../middlewares/roleCheck")
const checkAccountStatus = require("../middlewares/checkAccountStatus")
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


router.delete("/", checkAccountStatus, deleteUser)

router.post("/activate", checkAccountStatus, checkRole(["superadmin"]), activateUser)

router.post("/suspend", checkAccountStatus, checkRole(["superadmin"]), suspendUser)


module.exports = router