// STEP 3: Extended realistic SAMPLE data for all module screens (UI/design validation only).
// Not connected to live backend data. Do not treat as real records.

export const sampleBusinesses = [
  { id: 'org_2001', name: 'Sharma Kirana Store', owner: 'Ramesh Sharma', email: 'ramesh@sharmakirana.in', gst: '27AABCS1429B1Z5', type: 'Grocery', users: 2, products: 86, sales: 184520, plan: 'Free', status: 'Active', joined: '2026-10-02T10:12:00+05:30', city: 'Mumbai, MH' },
  { id: 'org_2002', name: 'Gupta Medicals', owner: 'Neha Gupta', email: 'neha@guptamedicals.in', gst: '07AACCG3214K1Z2', type: 'Pharmacy', users: 4, products: 540, sales: 1264300, plan: 'Starter (Monthly)', status: 'Active', joined: '2026-08-14T14:05:00+05:30', city: 'New Delhi, DL' },
  { id: 'org_2003', name: 'Patel Electronics', owner: 'Arun Patel', email: 'arun@patelelectronics.in', gst: '24AABCP7781M1Z9', type: 'Electronics', users: 3, products: 312, sales: 842900, plan: 'Starter (Monthly)', status: 'Suspended', joined: '2026-06-21T11:30:00+05:30', city: 'Ahmedabad, GJ' },
  { id: 'org_2004', name: 'Sai Stationery', owner: 'Kavita Iyer', email: 'kavita@sai-stationery.in', gst: '29AACCS9912P1Z4', type: 'Stationery', users: 6, products: 1430, sales: 2214500, plan: 'Pro (Yearly)', status: 'Active', joined: '2026-03-09T09:00:00+05:30', city: 'Bengaluru, KA' },
  { id: 'org_2005', name: 'Fresh Mart', owner: 'Imran Khan', email: 'imran@freshmart.in', gst: '27AABCF2210L1Z1', type: 'Supermarket', users: 1, products: 24, sales: 12400, plan: 'Trial', status: 'Trial', joined: '2026-11-10T19:20:00+05:30', city: 'Pune, MH' },
  { id: 'org_2006', name: 'Verma Sweets', owner: 'Pooja Verma', email: 'pooja@vermasweets.in', gst: '09AABCV5532Q1Z8', type: 'Food & Beverage', users: 3, products: 210, sales: 534200, plan: 'Starter (Yearly)', status: 'Active', joined: '2026-05-18T12:40:00+05:30', city: 'Lucknow, UP' }
];

export const sampleSubscriptions = [
  { id: 'sub_3001', business: 'Gupta Medicals', customer: 'Neha Gupta', plan: 'Starter', cycle: 'Monthly', status: 'Active', amount: 299, start: '2026-11-01T00:00:00+05:30', renewal: '2026-12-01T00:00:00+05:30', paymentStatus: 'Paid', source: 'Razorpay' },
  { id: 'sub_3002', business: 'Sai Stationery', customer: 'Kavita Iyer', plan: 'Pro', cycle: 'Yearly', status: 'Cancelled', amount: 6999, start: '2026-03-09T00:00:00+05:30', renewal: '2027-03-09T00:00:00+05:30', paymentStatus: 'Paid', source: 'Razorpay', note: 'Cancels at period end' },
  { id: 'sub_3003', business: 'Fresh Mart', customer: 'Imran Khan', plan: 'Starter', cycle: 'Monthly', status: 'Trial', amount: 299, start: '2026-11-10T00:00:00+05:30', renewal: '2026-11-24T00:00:00+05:30', paymentStatus: 'Trial', source: 'System' },
  { id: 'sub_3004', business: 'Sharma Kirana Store', customer: 'Ramesh Sharma', plan: 'Free', cycle: '-', status: 'Free', amount: 0, start: '2026-10-02T00:00:00+05:30', renewal: '-', paymentStatus: 'N/A', source: 'Default' },
  { id: 'sub_3005', business: 'Patel Electronics', customer: 'Arun Patel', plan: 'Starter', cycle: 'Monthly', status: 'Expired', amount: 299, start: '2026-09-01T00:00:00+05:30', renewal: '2026-10-01T00:00:00+05:30', paymentStatus: 'Failed', source: 'Razorpay' },
  { id: 'sub_3006', business: 'Anand Traders', customer: 'Suresh Anand', plan: 'Pro', cycle: 'Monthly', status: 'Pending', amount: 699, start: '2026-11-11T00:00:00+05:30', renewal: '2026-12-11T00:00:00+05:30', paymentStatus: 'Pending', source: 'Razorpay' }
];

export const samplePlans = [
  { id: 'plan_free', name: 'Free', code: 'free', status: 'Active', monthly: 0, yearly: 0, trialDays: 0, invoices: '50 / month', products: '100', staff: '1', businesses: '1', storage: 'Basic', features: ['Billing', 'Inventory', 'Receipts', 'Sales history', 'Customers'], version: 'v3', updated: '2026-09-01T10:00:00+05:30' },
  { id: 'plan_starter', name: 'Starter', code: 'starter', status: 'Active', monthly: 299, yearly: 2999, trialDays: 14, invoices: '1,000 / month', products: '2,000', staff: '3', businesses: '1', storage: 'Standard', features: ['All Free', 'Returns', 'Stock timeline', 'Damage tracking', 'CSV export', 'WhatsApp PDF'], version: 'v5', updated: '2026-10-15T12:00:00+05:30' },
  { id: 'plan_pro', name: 'Pro', code: 'pro', status: 'Active', monthly: 699, yearly: 6999, trialDays: 14, invoices: 'Unlimited', products: 'Unlimited', staff: '10', businesses: 'Multiple', storage: 'Extended', features: ['All Starter', 'Advanced reports', 'Multi-store', 'Priority support', 'API access'], version: 'v4', updated: '2026-10-15T12:00:00+05:30' },
  { id: 'plan_growth', name: 'Growth (Draft)', code: 'growth', status: 'Draft', monthly: 499, yearly: 4999, trialDays: 14, invoices: '3,000 / month', products: '5,000', staff: '5', businesses: '2', storage: 'Standard+', features: ['Starter+', 'Advanced reports (lite)'], version: 'v1', updated: '2026-11-08T16:20:00+05:30' }
];

export const samplePayments = [
  { id: 'pay_4001', customer: 'Neha Gupta', business: 'Gupta Medicals', amount: 299, status: 'Success', type: 'Subscription', gateway: 'Razorpay', gatewayRef: 'pay_Nm8s7Kx2Q1', invoice: 'INV-SA-18421', date: '2026-11-11T08:55:00+05:30', verified: 'Webhook verified' },
  { id: 'pay_4002', customer: 'Kavita Iyer', business: 'Sai Stationery', amount: 6999, status: 'Success', type: 'Subscription', gateway: 'Razorpay', gatewayRef: 'pay_Nm1a2Bc3D4', invoice: 'INV-SA-18402', date: '2026-11-09T14:10:00+05:30', verified: 'Webhook verified' },
  { id: 'pay_4003', customer: 'Arun Patel', business: 'Patel Electronics', amount: 299, status: 'Failed', type: 'Subscription', gateway: 'Razorpay', gatewayRef: 'pay_Nl9x8Yz7W6', invoice: 'INV-SA-18388', date: '2026-11-11T07:31:00+05:30', verified: 'Webhook verified' },
  { id: 'pay_4004', customer: 'Suresh Anand', business: 'Anand Traders', amount: 699, status: 'Pending', type: 'Subscription', gateway: 'Razorpay', gatewayRef: 'order_Nm9p0Qr1S2', invoice: 'INV-SA-18422', date: '2026-11-11T10:05:00+05:30', verified: 'Awaiting webhook' },
  { id: 'pay_4005', customer: 'Pooja Verma', business: 'Verma Sweets', amount: 2999, status: 'Refunded', type: 'Subscription', gateway: 'Razorpay', gatewayRef: 'rfnd_Nk2m3Np4Q5', invoice: 'INV-SA-18210', date: '2026-10-28T11:40:00+05:30', verified: 'Webhook verified' }
];

export const sampleAnnouncements = [
  { id: 'ann_1', title: 'New: Stock timeline improvements', category: 'New Feature Update', audience: 'All users', status: 'Published', publishAt: '2026-11-05T10:00:00+05:30', expiresAt: '2026-11-20T23:59:00+05:30', delivery: 1620, read: 1114, readRate: '68.8%' },
  { id: 'ann_2', title: 'Scheduled maintenance: 16 Nov, 01:00–02:00 IST', category: 'Scheduled Maintenance', audience: 'All users', status: 'Scheduled', publishAt: '2026-11-15T18:00:00+05:30', expiresAt: '2026-11-16T02:30:00+05:30', delivery: 0, read: 0, readRate: '—' },
  { id: 'ann_3', title: 'Payment retry reminder', category: 'Payment-related Announcement', audience: 'Paid plan users', status: 'Published', publishAt: '2026-11-08T09:00:00+05:30', expiresAt: '2026-11-12T23:59:00+05:30', delivery: 734, read: 402, readRate: '54.8%' },
  { id: 'ann_4', title: 'Emergency: Gateway latency advisory', category: 'Emergency Alert', audience: 'All users', status: 'Expired', publishAt: '2026-10-30T13:00:00+05:30', expiresAt: '2026-10-30T18:00:00+05:30', delivery: 1588, read: 1201, readRate: '75.6%' }
];

export const sampleMaintenance = {
  current: { mode: 'Off', message: 'No active maintenance.', countdown: null, adminBypass: true, allowWebhooks: true },
  schedule: { nextStart: '2026-11-16T01:00:00+05:30', nextEnd: '2026-11-16T02:00:00+05:30', status: 'Scheduled', message: 'Routine database maintenance and performance improvements.' },
  history: [
    { id: 'mnt_1', type: 'Scheduled', start: '2026-10-20T01:00:00+05:30', end: '2026-10-20T01:40:00+05:30', status: 'Completed', actor: 'Owner', note: 'Index optimization' },
    { id: 'mnt_2', type: 'Emergency', start: '2026-10-30T13:10:00+05:30', end: '2026-10-30T13:35:00+05:30', status: 'Completed', actor: 'Admin', note: 'Gateway failover' },
    { id: 'mnt_3', type: 'Scheduled', start: '2026-11-16T01:00:00+05:30', end: '2026-11-16T02:00:00+05:30', status: 'Scheduled', actor: 'Operations Manager', note: 'Routine maintenance' }
  ]
};

export const sampleNotifications = [
  { id: 'ntf_1', title: 'Subscription renewal reminder batch', category: 'Payment', audience: 'Paid plan users', status: 'Published', channel: 'In-app', scheduled: '2026-11-10T09:00:00+05:30', published: '2026-11-10T09:00:00+05:30', expires: '2026-11-13T23:59:00+05:30', delivered: 734, read: 489 },
  { id: 'ntf_2', title: 'Maintenance pre-notice', category: 'Maintenance', audience: 'All users', status: 'Scheduled', channel: 'In-app', scheduled: '2026-11-15T18:00:00+05:30', published: '-', expires: '2026-11-16T02:30:00+05:30', delivered: 0, read: 0 },
  { id: 'ntf_3', title: 'New report filters available', category: 'Feature', audience: 'Paid plan users', status: 'Expired', channel: 'In-app', scheduled: '2026-10-18T11:00:00+05:30', published: '2026-10-18T11:00:00+05:30', expires: '2026-10-25T23:59:00+05:30', delivered: 688, read: 501 }
];

export const sampleTeam = [
  { id: 'adm_1', name: 'Platform Owner', email: 'owner@hisaab.local', role: 'Super Admin / Owner', status: 'Active', lastActive: '2026-11-11T10:20:00+05:30', created: '2026-01-10T09:00:00+05:30' },
  { id: 'adm_2', name: 'Anita Desai', email: 'anita.admin@hisaab.local', role: 'Admin', status: 'Active', lastActive: '2026-11-11T09:05:00+05:30', created: '2026-03-02T10:30:00+05:30' },
  { id: 'adm_3', name: 'Rahul Mehta', email: 'rahul.dev@hisaab.local', role: 'Developer', status: 'Active', lastActive: '2026-11-11T08:40:00+05:30', created: '2026-04-12T11:15:00+05:30' },
  { id: 'adm_4', name: 'Sara Khan', email: 'sara.support@hisaab.local', role: 'Customer Support', status: 'Active', lastActive: '2026-11-10T17:55:00+05:30', created: '2026-05-20T09:45:00+05:30' },
  { id: 'adm_5', name: 'Vikram Rao', email: 'vikram.finance@hisaab.local', role: 'Finance Manager', status: 'Active', lastActive: '2026-11-11T09:30:00+05:30', created: '2026-06-01T12:00:00+05:30' },
  { id: 'adm_6', name: 'Meera Nair', email: 'meera.ops@hisaab.local', role: 'Operations Manager', status: 'Invited', lastActive: '-', created: '2026-11-09T15:10:00+05:30' }
];

export const sampleAuditLogs = [
  { id: 'aud_9001', time: '2026-11-11T09:18:00+05:30', actor: 'Anita Desai (Admin)', action: 'subscription.change_plan', entity: 'Subscription sub_3001', before: 'Starter Monthly', after: 'Starter Monthly (renewed)', ip: '103.21.**.**' },
  { id: 'aud_9002', time: '2026-11-11T08:12:00+05:30', actor: 'Platform Owner', action: 'user.suspend', entity: 'User acc_1003', before: 'Active', after: 'Suspended', ip: '49.36.**.**' },
  { id: 'aud_9003', time: '2026-11-10T18:30:00+05:30', actor: 'Meera Nair (Ops)', action: 'maintenance.schedule', entity: 'Maintenance mnt_3', before: 'None', after: 'Scheduled 2026-11-16 01:00 IST', ip: '122.161.**.**' },
  { id: 'aud_9004', time: '2026-11-10T16:05:00+05:30', actor: 'Platform Owner', action: 'plan.price_update', entity: 'Plan starter v5', before: '₹299 / ₹2,999', after: '₹299 / ₹2,999 (limits updated)', ip: '49.36.**.**' },
  { id: 'aud_9005', time: '2026-11-09T15:10:00+05:30', actor: 'Platform Owner', action: 'team.invite', entity: 'meera.ops@hisaab.local', before: '-', after: 'Invited as Operations Manager', ip: '49.36.**.**' },
  { id: 'aud_9006', time: '2026-11-08T09:02:00+05:30', actor: 'Anita Desai (Admin)', action: 'announcement.publish', entity: 'Announcement ann_3', before: 'Draft', after: 'Published', ip: '103.21.**.**' }
];

export const sampleTickets = [
  { id: 'TKT-1042', customer: 'Arun Patel', business: 'Patel Electronics', subject: 'Unable to renew subscription after failed payment', category: 'Billing', priority: 'High', status: 'In Progress', assignee: 'Sara Khan', updated: '2026-11-11T09:20:00+05:30', created: '2026-11-10T16:40:00+05:30' },
  { id: 'TKT-1041', customer: 'Imran Khan', business: 'Fresh Mart', subject: 'Clarification on trial invoice limits', category: 'Plans', priority: 'Medium', status: 'Waiting for Customer', assignee: 'Sara Khan', updated: '2026-11-11T08:10:00+05:30', created: '2026-11-10T19:45:00+05:30' },
  { id: 'TKT-1039', customer: 'Ramesh Sharma', business: 'Sharma Kirana Store', subject: 'Need help exporting sales report', category: 'Product Usage', priority: 'Low', status: 'Open', assignee: 'Unassigned', updated: '2026-11-10T11:05:00+05:30', created: '2026-11-10T11:05:00+05:30' },
  { id: 'TKT-1036', customer: 'Pooja Verma', business: 'Verma Sweets', subject: 'Refund status inquiry', category: 'Payments', priority: 'Medium', status: 'Resolved', assignee: 'Vikram Rao', updated: '2026-11-09T13:30:00+05:30', created: '2026-11-08T10:20:00+05:30' },
  { id: 'TKT-1032', customer: 'Neha Gupta', business: 'Gupta Medicals', subject: 'GST details update request', category: 'Account', priority: 'Low', status: 'Closed', assignee: 'Sara Khan', updated: '2026-11-07T17:00:00+05:30', created: '2026-11-06T09:50:00+05:30' }
];

export const sampleHealth = {
  services: [
    { name: 'Backend API', status: 'Healthy', detail: 'All endpoints responding', latency: '142 ms p95' },
    { name: 'Database (Primary)', status: 'Connected', detail: 'Connection pool stable', latency: '18 ms avg' },
    { name: 'Supabase Integration', status: 'Healthy', detail: 'Auth and data APIs reachable', latency: '210 ms p95' },
    { name: 'Payment Gateway (Razorpay)', status: 'Degraded', detail: 'Intermittent webhook retries', latency: '—' },
    { name: 'Background Jobs', status: 'Healthy', detail: 'Queues processing normally', latency: '0 delayed' }
  ],
  metrics: [
    { label: 'Application uptime', value: '99.96%', meta: 'Last 30 days' },
    { label: 'API response time', value: '142 ms', meta: 'p95, last hour' },
    { label: 'Error rate', value: '0.4%', meta: 'Last hour' },
    { label: 'Failed requests', value: '23', meta: 'Last hour' },
    { label: 'Storage usage', value: '38.4 GB', meta: 'of 200 GB' },
    { label: 'Database usage', value: '12.7 GB', meta: 'Managed instance' }
  ],
  errors: [
    { id: 'err_1', severity: 'Critical', time: '2026-11-11T07:58:00+05:30', source: 'payments.webhook', message: 'Webhook retry threshold reached for provider event', status: 'Investigating' },
    { id: 'err_2', severity: 'Warning', time: '2026-11-11T06:12:00+05:30', source: 'reports.export', message: 'Export job exceeded soft time limit (recovered)', status: 'Resolved' },
    { id: 'err_3', severity: 'Info', time: '2026-11-10T22:40:00+05:30', source: 'auth.session', message: 'Elevated login failure rate detected and rate-limited', status: 'Mitigated' }
  ]
};

export const sampleReports = [
  { id: 'user_growth', name: 'User growth', description: 'Registrations, activations, and cohort trends over time.', lastRun: '2026-11-11T08:00:00+05:30', format: 'Table + Chart + CSV' },
  { id: 'revenue', name: 'Revenue reports', description: 'MRR, ARR, total revenue, and period comparisons.', lastRun: '2026-11-11T08:00:00+05:30', format: 'Table + Chart + CSV' },
  { id: 'subscription_perf', name: 'Subscription performance', description: 'Active/trial/expired/cancelled trends and renewals.', lastRun: '2026-11-11T08:00:00+05:30', format: 'Table + Chart + CSV' },
  { id: 'plan_revenue', name: 'Plan-wise revenue', description: 'Revenue and subscriber distribution by plan and cycle.', lastRun: '2026-11-10T18:00:00+05:30', format: 'Table + CSV' },
  { id: 'conversion', name: 'Free-to-paid conversion', description: 'Conversion funnel and time-to-convert metrics.', lastRun: '2026-11-10T18:00:00+05:30', format: 'Table + Chart + CSV' },
  { id: 'cancellation', name: 'Cancellation rate', description: 'Churn, cancellation reasons (when available), and retention.', lastRun: '2026-11-10T18:00:00+05:30', format: 'Table + Chart + CSV' },
  { id: 'payment_failure', name: 'Payment failure rate', description: 'Failed/pending payments by provider, reason, and period.', lastRun: '2026-11-11T07:45:00+05:30', format: 'Table + Chart + CSV' },
  { id: 'customer_activity', name: 'Customer activity', description: 'Active businesses, usage signals, and engagement trends.', lastRun: '2026-11-10T18:00:00+05:30', format: 'Table + CSV' },
  { id: 'business_reg', name: 'Business registration trends', description: 'New businesses by period, region, and type.', lastRun: '2026-11-10T18:00:00+05:30', format: 'Table + Chart + CSV' }
];

export const sampleSettings = {
  platform: { name: 'Hisaab POS', tagline: 'Billing & POS for Indian small businesses', currency: 'INR (₹)', timezone: 'Asia/Kolkata', locale: 'en-IN' },
  tax: { gstEnabled: true, defaultGstRate: '18%', pricesInclusive: false },
  email: { provider: 'Not configured (sample)', sender: 'noreply@hisaab.local', status: 'Pending setup' },
  payment: { primary: 'Razorpay', secondary: 'Cashfree (future)', mode: 'Test/Config pending', webhooks: 'Server-verified only' },
  security: { sessionTimeout: '30 days (sample)', mfa: 'Available in roadmap', ipPolicy: 'Not enforced' },
  retention: { auditRetention: '365 days (sample)', exportPolicy: 'Permission-gated', backups: 'Configured (sample)' }
};
