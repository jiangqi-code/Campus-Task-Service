import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { requireRole } from '../middleware/role.middleware'
import { adminCoupons, adminCreate, adminDelete, adminGive, adminUpdate, adminUsage } from '../controllers/coupon.controller'

const router = Router()
router.use(requireAuth, requireRole('ADMIN'))
router.get('/', adminCoupons)
router.post('/', adminCreate)
router.put('/:couponId', adminUpdate)
router.delete('/:couponId', adminDelete)
router.get('/usage/:couponId', adminUsage)
router.post('/give', adminGive)
export default router
