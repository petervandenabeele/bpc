/* jshint node: true */
'use strict';

// Bootstrap the testing harness.
const sinon = require('sinon');
const test_data = require('./data/test_data');
const bpc_helper = require('./helpers/bpc_helper');
const MongoDB = require('./mocks/mongodb_mock');
// const Permissions = require('./../server/permissions');

// Test shortcuts.
const { expect, describe, it, before, after } = exports.lab = require('lab').script();


describe('permissions - functional tests', () => {

  let appTicket;
  const bt = test_data.applications.bt;
  const simple_first_user = test_data.users.simple_first_user;

  before(done => {
    MongoDB.reset().then(done);
  });

  after(done => {
    MongoDB.clear().then(done);
  });

  // Getting the appTicket
  before(done => {
    bpc_helper.request({ method: 'POST', url: '/ticket/app' }, bt)
    .then(response => {
      appTicket = response.result;
    })
    .then(done)
    .catch(done);
  });


  describe('getting user permissions with an app ticket', () => {

    it('getting first user bt permissions', (done) => {
      bpc_helper.request({ url: '/permissions/' + simple_first_user.id + '/bt' }, appTicket)
      .then(response => {
        expect(response.statusCode).to.equal(200);
        expect(response.result.bt_paywall).to.true();
        done();
      })
      .catch(done);
    });

    it('getting first user bt permissions by provider and uppercase email', (done) => {
      bpc_helper.request({ url: '/permissions/gigya/FIRST_USER@berlingskemedia.dk/bt' }, appTicket)
      .then(response => {
        expect(response.statusCode).to.equal(200);
        expect(response.result.bt_subscription_tier).to.equal('free');
        done();
      })
      .catch(done);
    });


    it('denied first user berlingske permissions', (done) => {
      bpc_helper.request({ url: '/permissions/' + simple_first_user.id + '/berlingske' }, appTicket)
      .then(response => {
        expect(response.statusCode).to.equal(403);
        done();
      })
      .catch(done);
    });

    it('getting non-existing user permissions', (done) => {
      bpc_helper.request({ url: '/permissions/thisuserdoesnotexist/bt' }, appTicket)
      .then(response => {
        expect(response.statusCode).to.equal(404);
        done();
      })
      .catch(done);
    });

  });


  describe('non-existing user permissions with an app ticket', () => {

    it('updating will result in not found', (done) => {
      const payload = {
        $inc: { "test_integer": 2 }
      };

      bpc_helper.request({ url: '/permissions/thisuserdoesnotexist/bt', method: 'PATCH', payload: payload}, appTicket)
      .then(response => {
        expect(response.statusCode).to.equal(404);
        done();
      })
      .catch(done);
    });

    it('setting will result in being created', (done) => {
      const payload = {
        "test_integer": 2
      };

      bpc_helper.request({ url: '/permissions/thisuserdoesnotexisteither/bt', method: 'POST', payload: payload}, appTicket)
      .then(response => {
        expect(response.statusCode).to.equal(200);
      })
      .then(() => MongoDB.collection('users').findOne({id: 'thisuserdoesnotexisteither'}))
      .then(user => {
        expect(user.dataScopes.bt.test_integer).to.equal(2);
        expect(user.createdAt).to.exist();
        // expect(user.lastUpdated).to.exist();
        // expect(user.lastUpdated).to.equal(user.createdAt);
      })
      .then(done)
      .catch(done);
    });
  });


  describe('getting user permissions with user ticket', () => {

    const simple_first_user_bt_grant = test_data.grants.simple_first_user_bt_grant;
    let simple_first_user_ticket;


    before(done => {
      bpc_helper.generateRsvp(bt, simple_first_user_bt_grant)
      .then(rsvp => bpc_helper.request({ method: 'POST', url: '/ticket/user', payload: { rsvp: rsvp } }, appTicket))
      .then(response => {
        expect(response.statusCode).to.equal(200);
        simple_first_user_ticket = response.result;
        done();
      });
    });

    it('validating by query all correct', (done) => {

      var queryPermissions = '?bt_subscription_tier=free&bt_paywall=true'
      bpc_helper.request({ url: '/permissions/bt' + queryPermissions }, simple_first_user_ticket)
      .then(response => {
        expect(response.statusCode).to.equal(200);
        done();
      })
      .catch(done);
    });


    it('validating by query one false', (done) => {

      var queryPermissions = '?bt_subscription_tier=free&bt_paywall=false'

      bpc_helper.request({ url: '/permissions/bt' + queryPermissions }, simple_first_user_ticket)
      .then(response => {
        expect(response.statusCode).to.equal(404);
        done();
      })
      .catch(done);
    });
  });
});
