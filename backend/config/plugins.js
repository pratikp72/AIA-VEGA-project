module.exports = ({ env }) => ({
  /**
   * Local admin plugin: Modules Sidebar
   */
  'modules-sidebar': {
    enabled: true,
    resolve: './src/plugins/modules-sidebar',
  },

  /**
   * Local plugin: Analytics Dashboard
   */
  'analytics-dashboard': {
    enabled: true,
    resolve: './src/plugins/analytics-dashboard',
  },

  /**
   * Local plugin: Audit Log
   */
  'audit-log': {
    enabled: true,
    resolve: './src/plugins/audit-log',
  },

  /**
   * Local plugin: Quiz Reattempt Requests
   */
  'quiz-reattempt-requests': {
    enabled: true,
    resolve: './src/plugins/quiz-reattempt-requests',
  },

  /**
   * Local plugin: Profile Edit Requests
   */
  'profile-edit-requests': {
    enabled: true,
    resolve: './src/plugins/profile-edit-requests',
  },

  /**
   * 📧 Email Provider (Nodemailer)
   */
  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('SMTP_HOST', 'smtp.gmail.com'),
        port: env.int('SMTP_PORT', 587),
        secure: false,
        auth: {
          user: env('SMTP_USERNAME'),
          pass: env('SMTP_PASSWORD'),
        },
      },
      settings: {
        defaultFrom: env('EMAIL_FROM', 'noreply@example.com'),
        defaultReplyTo: env('EMAIL_REPLY_TO', 'noreply@example.com'),
      },
    },
  },

  /**
   * 🔌 IO Plugin (WebSockets / Realtime)
   */
  io: {
    enabled: true,
    config: {
      contentTypes: ['api::quiz-submission.quiz-submission'],
      socketIO: {
        cors: {
          origin: '*',
        },
      },
    },
  },
});