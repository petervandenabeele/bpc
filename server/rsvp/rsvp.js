/*jshint node: true */
'use strict';

const Oz = require('oz');
const Boom = require('boom');
const crypto = require('crypto');
const MongoDB = require('./../mongo/mongodb_client');
const Applications = require('./../applications/applications');
const Users = require('./../users/users');
const Gigya = require('./../gigya/gigya_client');
const Google = require('./../google/google_client');

const ENCRYPTIONPASSWORD = process.env.ENCRYPTIONPASSWORD;


module.exports = {
  create: function (data) {
    if (data.provider === 'gigya') {
      // return createGigyaRsvp(data).then(callback);
      return createGigyaRsvp(data);
    } else if (data.provider === 'google') {
      return createGoogleRsvp(data);
    } else {
      return Promise.reject(Boom.badRequest('Unsupported provider'));
    }
  },
  grantIsExpired: function (grant) {
    return (
      grant !== undefined &&
      grant !== null &&
      grant.exp !== undefined &&
      grant.exp !== null &&
      grant.exp < Oz.hawk.utils.now()
    );
  }
};

var grantIsExpired = module.exports.grantIsExpired;

// Here we are creating the user->app rsvp.


function createGigyaRsvp(data) {
  // 1. first find the app.
  // 2. Check if the app allows for dynamic creating of grants
  // 3. Check if the app uses Gigya accounts or perhaps pre-defined users
  //    (e.g. server-to-server auth keys)
  // Vefify the user is created in Gigya

  let exchangeUIDSignatureParams = {
    UID: data.UID,
    UIDSignature: data.UIDSignature,
    signatureTimestamp: data.signatureTimestamp
  };

  return Gigya.callApi('/accounts.exchangeUIDSignature', exchangeUIDSignatureParams)
  .then(result => Gigya.callApi('/accounts.getAccountInfo', { UID: data.UID }))
  .then(result => validateEmail(data, result.body.profile.email))
  .then(() => toLowerCaseEmail(data))
  .then(data => findGrant({ user: data.email, app: data.app, provider: data.provider }));
}


function createGoogleRsvp(data) {
  // Verify the user with Google.
  return Google.tokeninfo(data)
  .then(result => validateEmail(data, result.email))
  .then(() => toLowerCaseEmail(data))
  .then(data => findGrant({ user: data.email, app: data.app, provider: data.provider }));
}


function validateEmail(data, email) {
  if (data.email !== email) {
    return Promise.reject(Boom.badRequest('Invalid email'));
  } else {
    return Promise.resolve();
  }
}


function toLowerCaseEmail(data) {
  data.email = data.email.toLowerCase();
  return Promise.resolve(data);
}


function findGrant(data) {

  return MongoDB.collection('applications')
  .findOne(
    { id: data.app },
    { fields: { _id: 0 } })
  .then (app => {
    if (app === null){
      return Promise.reject(Boom.unauthorized('Unknown application'));
    } else if (app.settings && app.settings.provider && app.settings.provider !== data.provider){
      return Promise.reject(Boom.unauthorized('Invalid provider'));
    } else {
      return Promise.resolve(app);
    }
  })
  .then(app => {

    // We only looking for any grants between user and app.
    // We only insert a new one if none is found, the app allows it creation of now blank grants.
    // If the existing grant is expired, the user should be denied access.
    return MongoDB.collection('grants').findOne(
      { user: data.user, app: data.app },
      { fields: { _id: 0 } })
    .then(grant => {

        // The setting disallowAutoCreationGrants makes sure that no grants
        // are created automatically.
      if (grant === null &&
        (app.disallowAutoCreationGrants ||
          (app.settings && app.settings.disallowAutoCreationGrants))) {

            return Promise.reject(Boom.forbidden());

      } else if (grantIsExpired(grant)) {

        return Promise.reject(Boom.forbidden());

      } else if (grant === null ) {

        // Creating new clean grant
        grant = {
          app: data.app,
          user: data.user,
          scope: []
        };

        Applications.createAppGrant(grant);

      }

      // This exp is only the expiration of the rsvp - not the expiration of
      // the grant/ticket.
      if (grant.exp === undefined || grant.exp === null) {
        grant.exp = Oz.hawk.utils.now() + (60000 * 60); // 60000 = 1 minute
      }

      return new Promise((resolve, reject) => {
        // Generating the RSVP based on the grant
        Oz.ticket.rsvp(app, grant, ENCRYPTIONPASSWORD, {}, (err, rsvp) => {
          if (err) {
            console.error(err);
            return reject(err);
          }
          // After granting app access, the user returns to the app with the rsvp.
          return resolve(rsvp);
        });
      });
    });
  })
  .catch(err => {
    if(err.isBoom){
      return Promise.reject(err);
    } else {
      return Promise.reject(Boom.unauthorized(err.message));
    }
  });

}
