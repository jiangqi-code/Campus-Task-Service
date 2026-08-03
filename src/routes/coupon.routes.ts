import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { apply, available, check, claim, mine, notification, receive, usable, use } from '../controllers/coupon.controller'

const router = Router()
router.use(requireAuth)
router.get('/available', available)
router.get('/usable', usable)
router.get('/check-notification', notification)
router.get('/my', mine)
router.post('/claim', claim)
router.post('/use', use)
router.post('/receive/:couponId', receive)
router.post('/apply', apply)
router.get('/check/:code', check)
export default router
