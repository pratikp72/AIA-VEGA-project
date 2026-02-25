"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/quiz-reattempt-request/send",
      handler: "quiz-reattempt-request.send",
      config: {
        policies: [],
      },
    },
  ],
};