import schedule from 'node-schedule'
import { triggerCouponDistribution } from './couponAutomation.service'

let job: schedule.Job | null = null
export const couponSchedulerService = {
  start() {
    if (job) return
    job = schedule.scheduleJob('0 2 * * *', () => {
      void triggerCouponDistribution().then(result => console.log('[coupon-scheduler]', result)).catch(error => console.error('[coupon-scheduler]', error))
    })
  },
  stop() {
    job?.cancel()
    job = null
  },
}

