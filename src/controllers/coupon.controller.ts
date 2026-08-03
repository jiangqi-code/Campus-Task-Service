import type { RequestHandler } from 'express'
import { adminList, applyCoupon, checkCode, CouponError, createCoupon, deleteCoupon, giveCoupon, listAvailable, listMine, receiveCoupon, updateCoupon, usage } from '../services/coupon.service'

const ok = (res: any, data: unknown, message = 'success', status = 200) => res.status(status).json({ code: 0, message, data })
const handler = (fn: (req: any) => Promise<unknown>, message = 'success', status = 200): RequestHandler => async (req, res, next) => {
  try { ok(res, await fn(req), message, status) }
  catch (error) { if (error instanceof CouponError) res.status(error.status).json({ code: error.status, message: error.message, data: null }); else next(error) }
}

const userId = (req: any) => { if (!req.user) throw new CouponError(401, 'Unauthorized'); return req.user.id as number }
const adminId = (req: any) => { if (!req.user || req.user.role !== 'ADMIN') throw new CouponError(403, 'Forbidden'); return req.user.id as number }

export const available = handler((req) => listAvailable(userId(req)))
export const mine = handler((req) => listMine(userId(req), req.query))
export const receive = handler((req) => receiveCoupon(userId(req), String(req.params.couponId)), '领取成功', 201)
export const apply = handler((req) => applyCoupon(userId(req), req.body || {}))
export const check = handler((req) => checkCode(String(req.params.code || '')))

export const adminCoupons = handler((req) => { adminId(req); return adminList(req.query) })
export const adminCreate = handler((req) => createCoupon(adminId(req), req.body || {}), '创建成功', 201)
export const adminUpdate = handler((req) => { adminId(req); return updateCoupon(String(req.params.couponId), req.body || {}) }, '修改成功')
export const adminDelete = handler((req) => { adminId(req); return deleteCoupon(String(req.params.couponId)) }, '删除成功')
export const adminUsage = handler((req) => { adminId(req); return usage(String(req.params.couponId)) })
export const adminGive = handler((req) => { adminId(req); return giveCoupon(Number(req.body?.userId ?? req.body?.user_id), String(req.body?.couponId ?? req.body?.coupon_id)) }, '发放成功', 201)
