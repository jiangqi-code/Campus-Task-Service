import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { requireRole } from '../middleware/role.middleware'
import { adminCoupons, adminCreate, adminCreateEvent, adminDelete, adminDeleteEvent, adminEvents, adminGive, adminRecords, adminTrigger, adminUpdate, adminUpdateEvent, adminUsage } from '../controllers/coupon.controller'

const router = Router()
router.use(requireAuth, requireRole('ADMIN'))
router.get('/', adminCoupons)
router.post('/', adminCreate)
router.put('/:couponId', adminUpdate)
router.delete('/:couponId', adminDelete)
router.get('/usage/:couponId', adminUsage)
router.post('/give', adminGive)
router.get('/events', adminEvents)
router.post('/events', adminCreateEvent)
router.put('/events/:eventId', adminUpdateEvent)
router.delete('/events/:eventId', adminDeleteEvent)
router.get('/records', adminRecords)
router.post('/trigger', adminTrigger)
export default router
