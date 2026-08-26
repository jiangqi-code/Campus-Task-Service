import schedule from 'node-schedule'
import { triggerCouponDistribution } from './couponAutomation.service'

let job: schedule.Job | null = null

function runDistribution() {
  return triggerCouponDistribution()
    .then(result => console.log('[coupon-scheduler]', result))
    .catch(error => console.error('[coupon-scheduler]', error))
}

export const couponSchedulerService = {
  start() {
    if (job) return
    // Avoid missing birthday and holiday distribution when the service starts after 02:00.
    void runDistribution()
    job = schedule.scheduleJob('0 2 * * *', () => {
      void runDistribution()
    })
  },
  stop() {
    job?.cancel()
    job = null
  },
}
