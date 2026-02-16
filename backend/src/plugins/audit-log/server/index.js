const register = require('./register');
const bootstrap = require('./bootstrap');
const services = require('./services');
const contentTypes = require('./content-types');
const controllers = require('./controllers');
const routes = require('./routes');

module.exports = {
  register,
  bootstrap,
  services,
  contentTypes,
  controllers,
  routes,
};
