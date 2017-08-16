/* jshint node: true */
'use strict';

// Bootstrap the testing harness.
const sinon = require('sinon');
const test_data = require('./data/test_data');
const bpc_helper = require('./helpers/bpc_helper');
const Gigya = require('./mocks/gigya_mock');

// Test shortcuts.
const { describe, it, before, after } = exports.lab = require('lab').script();
// Assertion library
const { expect } = require('code');


describe('users - functional tests', () => {

  before(done => {
    bpc_helper.start().then(done);
  });


  describe('getting user with an app ticket', () => {

    var appTicket;
    var bt = test_data.applications.bt;
    var first = test_data.users.simple_first_user;

    // Getting the appTicket
    before((done) => {
      bpc_helper.request({ method: 'POST', url: '/ticket/app' }, {credentials: bt}, (response) => {
        expect(response.statusCode).to.equal(200);
        appTicket = {credentials: JSON.parse(response.payload), app: bt.id};
        done();
      });
    });

    it('getting first user bt permissions', (done) => {
      bpc_helper.request({ method: 'GET', url: '/permissions/' + first.id + '/bt'}, appTicket, (response) => {
        expect(response.statusCode).to.equal(200);
        var payload = JSON.parse(response.payload);
        expect(payload.bt_paywall).to.true();
        done();
      });
    });

  });

});


describe('users - integration tests', () => {

  let app = test_data.applications.app_with_users_scope;
  let appTicket;

  before(done => {
    bpc_helper.start().then(done);
  });

  // Getting the appTicket
  before(done => {
    bpc_helper.request({ method: 'POST', url: '/ticket/app' }, {credentials: app}, (response) => {
      expect(response.statusCode).to.equal(200);
      appTicket = {credentials: JSON.parse(response.payload), app: app.id};
      done();
    });
  });

  before(done => {
    // Gigya.callApi.withArgs('/accounts.initRegistration').resolves({body: {regToken: 'randomRegToken1234'}});
    // Gigya.callApi.withArgs('/accounts.register', {
    //   email: 'newuser@notyetcreated.nl',
    //   password: 'justsomerandomtext',
    //   finalizeRegistration: true,
    //   include: 'profile,data',
    //   format: 'json',
    //   regToken: 'randomRegToken1234'
    // }).resolves({body: {UID: 'randomUID1234'}});

    Gigya.callApi.onFirstCall().resolves({body: {regToken: 'randomRegToken1234'}});
    Gigya.callApi.onSecondCall().resolves({body: {UID: 'randomUID1234'}});
    done();
  });

  after(done => {
    Gigya.callApi.reset();
    done();
  });

  it('create new user', done => {
    let options = {
      method: 'POST',
      url: '/users/register',
      headers: {
      },
      payload: {
        email: 'newuser@notyetcreated.nl',
        password: 'justsomerandomtext'
      }
    };

    bpc_helper.request(options, appTicket, (response) => {
      expect(response.statusCode).to.equal(200);
      expect(response.payload).to.equal("{\"UID\":\"randomUID1234\"}");
      done();
    });
  });

});
