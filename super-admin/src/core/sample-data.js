// STEP 2: Realistic SAMPLE data for UI/design validation only.
// All consuming views must label this clearly as "Sample data" (not live backend data).

export const sampleMeta = {
  mode: 'sample',
  label: 'Sample data',
  note: 'Illustrative values for STEP 2 design validation. Not connected to live backend data.',
  generatedAt: '2026-11-11T10:30:00+05:30',
  timezone: 'Asia/Kolkata',
  currency: 'INR'
};

export const overviewKpis = [
  { id: 'total_users', label: 'Total Registered Users', value: 1842, delta: '+6.4%', trend: 'up', period: 'vs last 30 days' },
  { id: 'total_businesses', label: 'Total Businesses', value: 1268, delta: '+4.9%', trend: 'up', period: 'vs last 30 days' },
  { id: 'active_subscriptions', label: 'Active Subscriptions', value: 734, delta: '+3.1%', trend: 'up', period: 'current' },
  { id: 'free_users', label: 'Free Plan Users', value: 1108, delta: '+2.2%', trend: 'up', period: 'current' },
  { id: 'paid_users', label: 'Paid Plan Users', value: 734, delta: '+5.8%', trend: 'up', period: 'current' },
  { id: 'mrr', label: 'Monthly Recurring Revenue (MRR)', value: 312400, currency: true, delta: '+7.6%', trend: 'up', period: 'Nov 2026' },
  { id: 'arr', label: 'Annual Recurring Revenue (ARR)', value: 3748800, currency: true, delta: '+7.6%', trend: 'up', period: 'run-rate' },
  { id: 'total_revenue', label: 'Total Revenue', value: 1845600, currency: true, delta: '+12.3%', trend: 'up', period: 'all-time (sample)' },
  { id: 'new_registrations', label: 'New Registrations', value: 96, delta: '+11.6%', trend: 'up', period: 'last 30 days' },
  { id: 'cancellations', label: 'Subscription Cancellations', value: 18, delta: '-2.1%', trend: 'up-good', period: 'last 30 days' },
  { id: 'trial_conversions', label: 'Trial Conversions', value: 41, delta: '+4.0%', trend: 'up', period: 'last 30 days' },
  { id: 'failed_payments', label: 'Failed Payments', value: 7, delta: '+1', trend: 'down', period: 'last 30 days' }
];

export const registrationGrowth = [
  { label: 'May', value: 820 }, { label: 'Jun', value: 940 }, { label: 'Jul', value: 1080 },
  { label: 'Aug', value: 1235 }, { label: 'Sep', value: 1410 }, { label: 'Oct', value: 1620 }, { label: 'Nov', value: 1842 }
];

export const revenueGrowth = [
  { label: 'May', value: 148000 }, { label: 'Jun', value: 176500 }, { label: 'Jul', value: 201200 },
  { label: 'Aug', value: 238900 }, { label: 'Sep', value: 264300 }, { label: 'Oct', value: 289700 }, { label: 'Nov', value: 312400 }
];

export const subscriptionDistribution = [
  { label: 'Free', value: 1108, color: 'var(--chart-2)' },
  { label: 'Starter', value: 486, color: 'var(--chart-1)' },
  { label: 'Pro', value: 248, color: 'var(--chart-3)' }
];

export const freeVsPaid = [
  { label: 'Free users', value: 1108, color: 'var(--chart-4)' },
  { label: 'Paid users', value: 734, color: 'var(--chart-1)' }
];

export const monthlySubscriptionTrends = [
  { label: 'Jun', new: 52, cancelled: 9 }, { label: 'Jul', new: 61, cancelled: 11 },
  { label: 'Aug', new: 74, cancelled: 13 }, { label: 'Sep', new: 69, cancelled: 10 },
  { label: 'Oct', new: 83, cancelled: 16 }, { label: 'Nov', new: 88, cancelled: 18 }
];

export const recentActivity = [
  { id: 'a1', type: 'registration', title: 'New registration: Sharma Kirana Store', meta: 'Free plan • Mumbai, MH', time: '2026-11-11T09:42:00+05:30', status: 'info' },
  { id: 'a2', type: 'subscription', title: 'New subscription: Gupta Medicals → Starter (Monthly)', meta: '₹299.00 • Auto-renew on', time: '2026-11-11T09:18:00+05:30', status: 'success' },
  { id: 'a3', type: 'payment', title: 'Payment captured: INV-SA-18421', meta: '₹699.00 • Razorpay • Verified via webhook', time: '2026-11-11T08:55:00+05:30', status: 'success' },
  { id: 'a4', type: 'cancellation', title: 'Subscription cancelled: Sai Stationery', meta: 'Pro (Yearly) • Effective at period end', time: '2026-11-11T08:12:00+05:30', status: 'warning' },
  { id: 'a5', type: 'alert', title: 'System alert: Payment webhook retries increased', meta: '2 retries in last 15 min • Monitoring', time: '2026-11-11T07:58:00+05:30', status: 'danger' },
  { id: 'a6', type: 'payment', title: 'Payment failed: Patel Electronics', meta: '₹299.00 • Card declined', time: '2026-11-11T07:31:00+05:30', status: 'danger' },
  { id: 'a7', type: 'registration', title: 'New registration: Fresh Mart', meta: 'Trial started • Pune, MH', time: '2026-11-10T19:20:00+05:30', status: 'info' }
];

export const sampleUsers = [
  { id: 'acc_1001', name: 'Ramesh Sharma', email: 'ramesh@sharmakirana.in', business: 'Sharma Kirana Store', plan: 'Free', status: 'Active', registered: '2026-10-02T10:12:00+05:30', lastActive: '2026-11-11T09:40:00+05:30', invoices: 34, products: 86, businessType: 'Grocery' },
  { id: 'acc_1002', name: 'Neha Gupta', email: 'neha@guptamedicals.in', business: 'Gupta Medicals', plan: 'Starter', status: 'Active', registered: '2026-08-14T14:05:00+05:30', lastActive: '2026-11-11T09:10:00+05:30', invoices: 412, products: 540, businessType: 'Pharmacy' },
  { id: 'acc_1003', name: 'Arun Patel', email: 'arun@patelelectronics.in', business: 'Patel Electronics', plan: 'Starter', status: 'Suspended', registered: '2026-06-21T11:30:00+05:30', lastActive: '2026-11-03T17:22:00+05:30', invoices: 289, products: 312, businessType: 'Electronics' },
  { id: 'acc_1004', name: 'Kavita Iyer', email: 'kavita@sai-stationery.in', business: 'Sai Stationery', plan: 'Pro', status: 'Active', registered: '2026-03-09T09:00:00+05:30', lastActive: '2026-11-10T18:45:00+05:30', invoices: 1284, products: 1430, businessType: 'Stationery' },
  { id: 'acc_1005', name: 'Imran Khan', email: 'imran@freshmart.in', business: 'Fresh Mart', plan: 'Trial', status: 'Trial', registered: '2026-11-10T19:20:00+05:30', lastActive: '2026-11-11T08:02:00+05:30', invoices: 6, products: 24, businessType: 'Supermarket' }
];
