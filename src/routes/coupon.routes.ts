import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { apply, available, check, mine, receive } from '../controllers/coupon.controller'

const router = Router()
router.use(requireAuth)
router.get('/available', available)
router.get('/my', mine)
router.post('/receive/:couponId', receive)
router.post('/apply', apply)
router.get('/check/:code', check)
export default router
