/*jshint node: true */
'use strict';

const Boom = require('boom');
const Joi = require('joi');
const OzLoadFuncs = require('./../oz_loadfuncs');
const MongoDB = require('./../mongo/mongodb_client');
const crypto = require('crypto');
const EventLog = require('./../audit/eventlog');

module.exports = {

  getApplications: function (request, reply) {
    MongoDB.collection('applications').find(
      {},
      {
        _id: 0,
        id: 1,
        scope: 1
      }
    ).sort({id: 1})
    .toArray()
    .then(res => reply(res), err => reply(err));
  },


  postApplication: function (request, reply) {

    let app = {
      id: request.payload.id,
      key: crypto.randomBytes(25).toString('hex'),
      algorithm: 'sha256',
      scope: makeArrayUnique(request.payload.scope),
      delegate: request.payload.delegate ? request.payload.delegate : false,
      settings: request.payload.settings || {}
    };

    // Ensure that the id is unique before creating the application.
    convertToUniqueid(app.id)
    .then(uniqueId => {
      app.id = uniqueId;
      return Promise.resolve();
    })
    .then(() => MongoDB.collection('applications').insertOne(app))
    .then(res => {

      if (res.result.ok === 1){
        reply(app);
        return Promise.resolve();
      } else {
        reply(Boom.badRequest('app could not be created'));
        return Promise.reject();
      }

    })
    .then(() => OzLoadFuncs.parseAuthorizationHeader(request.headers.authorization))
    .then(ticket => {

      const ops_phase2 = [
        // Adding the admin:{id} scope to the application of the ticket issuer
        MongoDB.collection('applications')
        .update(
          { id: ticket.app },
          { $addToSet: { scope: 'admin:'.concat(app.id) } }
        ),
        // Adding the admin:{id} scope to the grant of the ticket owner
        MongoDB.collection('grants')
        .update(
          { id: ticket.grant },
          { $addToSet: { scope: 'admin:'.concat(app.id) } }
        )
      ];

      return Promise.all(ops_phase2);

    })
    .catch(err => {
      console.error(err);
    });
  },


  getApplication: function (request, reply) {
    MongoDB.collection('applications').findOne({id: request.params.id})
    .then(app => reply(app ? app : Boom.notFound()))
    .catch(err => reply(Boom.wrap(err)));
  },


  putApplication: function (request, reply) {
    MongoDB.collection('applications')
    .updateOne(
      { id: request.params.id },
      { $set: request.payload }
    )
    .then(res => reply({'status':'ok'}))
    .catch(err => reply(Boom.wrap(err)));
  },


  deleteApplication: function (request, reply) {

    const ops = [
      // Remove the application
      MongoDB.collection('applications').remove({ id: request.params.id }),
      // Remove all grants to that application
      MongoDB.collection('grants').remove({ app: request.params.id } )
    ];

    return Promise.all(ops)
    .then(res => {

      // We reply "ok" if the command was successfull.
      if (res[0].result.ok === 1) {
        reply({'status': 'ok'});
        return Promise.resolve();
      } else {
        reply(Boom.badRequest());
        return Promise.reject(res[0]);
      }

    })
    .then(() => OzLoadFuncs.parseAuthorizationHeader(request.headers.authorization))
    .then(ticket => {

      const ops_phase2 = [
        // Removing  the admin:{id} scope from the application of the ticket issuer
        MongoDB.collection('applications')
        .update(
          { id: ticket.app },
          { $pull: { scope: 'admin:'.concat(request.params.id) } }
        ),

        // Removing the admin:{id} scope from the grant of the ticket owner
        MongoDB.collection('grants')
        .update(
          { app: ticket.app },
          { $pull: { scope: 'admin:'.concat(request.params.id) } },
          { multi: true }
        )
      ];

      return Promise.all(ops_phase2);

    })
    .catch(err => {
      console.error(err);
    });
  },


  getApplicationGrants: function (request, reply) {
    const query = Object.assign(request.query, {
       app: request.params.id
    });

    MongoDB.collection('grants').find(
      query, {fields: {_id: 0}}
    ).toArray(reply);
  },


  postApplicationNewGrant: function (request, reply) {
    const grant = Object.assign(request.payload, {
      app: request.params.id
    });

    createAppGrant(grant)
    .then(grant => reply(grant))
    .catch(err => reply(err));

  },


  postApplicationGrant: function (request, reply) {
    const grant = Object.assign(request.payload, {
      id: request.params.grantId,
      app: request.params.id
    });

    updateAppGrant(grant)
    .then(grant => reply({'status':'ok'}))
    .catch(err => reply(err));
  },


  deleteApplicationGrant: function (request, reply) {
    MongoDB.collection('grants').removeOne({
      id: request.params.grantId, app: request.params.id
    })
    .then(result => reply({'status':'ok'}))
    .catch(err => reply(err));
  },


  getApplicationAdmins: function (request, reply) {
    OzLoadFuncs.parseAuthorizationHeader(request.headers.authorization)
    .then(ticket => {

      const query = {
         app: ticket.app,
         scope: 'admin:'.concat(request.params.id)
      };

      MongoDB.collection('grants').find(
        query, {fields: {_id: 0}}
      ).toArray(reply);
    })
    .catch(err => reply(err));
  },


  postApplicationMakeAdmin: function (request, reply) {
    OzLoadFuncs.parseAuthorizationHeader(request.headers.authorization)
    .then(ticket => {

      const query = Object.assign(request.payload, {
         app: ticket.app
      });

      MongoDB.collection('grants').findOne(
        query, {fields: {_id: 0}}
      ).then(grant => {
        if (grant === null) {

          grant = Object.assign(request.payload, {
             app: ticket.app
          });

          createAppGrant(grant)
          .then(newGrant => assignAdminScopeToGrant(newGrant));

        } else {

          assignAdminScopeToGrant(grant);

        }
      })
      .catch(err => reply(err));

      function assignAdminScopeToGrant(grant){
        assignAdminScopeToGrant(request.params.id, grant, ticket)
        .then(res => {
          if(res.result.n === 1) {

            EventLog.logUserEvent(
              request.params.id,
              'Added Admin Scope to User',
              {app: request.params.id, byUser: ticket.user}
            );

            reply({'status': 'ok'});

          } else {

            reply(Boom.badRequest());

          }
        });
      }
    })
    .catch(err => reply(err));
  },


  postApplicationRemoveAdmin: function (request, reply) {
    OzLoadFuncs.parseAuthorizationHeader(request.headers.authorization)
    .then(ticket => {

      if (ticket.user === request.payload.user){
        return Promise.reject(Boom.forbidden('You cannot remove yourself'));
      }

      removeAdminScopeFromGrant(request.params.id, request.payload, ticket)
      .then(res => {
        if(res.result.n === 1) {

          EventLog.logUserEvent(
            request.params.id,
            'Pulled Admin Scope from User',
            {app: request.params.id, byUser: ticket.user}
          );

          reply({'status': 'ok'});

        } else {

          reply(Boom.badRequest());

        }
      });
    })
    .catch(err => reply(err));
  }
};






// function assignAdminScopeToTicketGrant(ticket, app) {
//
//   return MongoDB.collection('grants')
//   .update(
//     { id: ticket.grant },
//     { $addToSet: { scope: 'admin:'.concat(app.id) } }
//   );
// }


// function createNewGrantWithAdmin(ticket, app) {
//   const newAdminGrant = {
//     id: crypto.randomBytes(20).toString('hex'),
//     app: app.id,
//     user: ticket.user,
//     scope: [ 'admin:'.concat(app.id)  ],
//     exp: null
//   };
//
//   return MongoDB.collection('grants')
//   .insertOne(newAdminGrant);
// }


/**
 * Updates a single application by overwriting its fields with the provided ones
 *
 * @param {String} App id
 * @param {Object} App object
 * @return {Promise} Promise providing the updated app
 */
// function updateApp(id, input) {
//
//   return MongoDB.collection('applications')
//   .updateOne(
//     {id:id},
//     {$set: input},
//     {returnNewDocument: true}
//   );
//
// }


/**
 * Deletes an application and updates (ie. removes) scopes and grants
 *
 * This operation requires the user ticket.
 *
 * @param {Object} User ticket
 * @param {String} App id
 * @return {Promise} Provides a bool True if app was deleted, False otherwise
 */
// function deleteApp(ticket, id) {
//
//   const adminScope = 'admin:'.concat(id);
//   const ops = [
//     MongoDB.collection('applications').remove({ id: id }),
//     MongoDB.collection('grants').remove({ app: id } ),
//     // Removing admin:{id} from grants to the console app
//     MongoDB.collection('grants')
//     .update(
//       { app: ticket.app },
//       { $pull: { scope: adminScope } },
//       { multi: true }
//     )
//   ];
//
//   return Promise.all(ops)
//     .then(res => Promise.resolve(res[0].result.n > 0))
//     .catch(err => {
//       console.error(err);
//       return Promise.reject(err);
//     });
//
// }


function assignAdminScopeToGrant(app, grant, ticket) {
  const query = Object.assign(grant, {
    app: ticket.app
  });

  const update = {
    $addToSet: { scope: 'admin:'.concat(app) }
  };

  return MongoDB.collection('grants')
  .updateOne(query, update);
}


function removeAdminScopeFromGrant(app, grant, ticket) {
  const query = Object.assign(grant, {
    app: ticket.app
  });

  const update = {
    $pull: { scope: 'admin:'.concat(app) }
  };

  return MongoDB.collection('grants')
  .updateOne(query, update);
}



/**
 * Creates an application grant
 *
 * @param {String} App id
 * @param {Object} Grant to create
 * @return {Promise} Promise providing the created grant
 */
function createAppGrant(grant) {

  if(!grant.app || !grant.user){
    return Promise.reject(Boom.badRequest('attribute app or user missing'));
  }

  grant.id = crypto.randomBytes(20).toString('hex');
  grant.scope = makeArrayUnique(grant.scope);

  const operations = [
    MongoDB.collection('applications')
    .findOne({id: grant.app}),

    MongoDB.collection('grants')
    .count({user: grant.user, app: grant.app}, {limit:1})
  ];

  return Promise.all(operations)
  .then(results => {
    let app = results[0];
    let existingGrant = results[1];

    if(existingGrant > 0){
      return Promise.reject(Boom.conflict());
    }

    if (!app){
      return Promise.reject(Boom.badRequest('invalid app'))
    }

    // Keep only the scopes allowed in the app scope.
    grant.scope = grant.scope.filter(i => app.scope.indexOf(i) > -1);
    return MongoDB.collection('grants').insertOne(grant)
    .then(res => grant);

  });

}


/**
 * Updates an app's grant
 *
 * @param {String} App id
 * @param {Object} Grant
 * @return {Promise} Promise providing the updated grant
 */
function updateAppGrant(grant) {

  return MongoDB.collection('applications')
  .findOne({id: grant.app})
  .then(app => {

    if (!app) {
      return Promise.reject(Boom.badRequest('invalid app'))
    }

    grant.scope = makeArrayUnique(grant.scope);
    // Keep only the scopes allowed in the app scope.
    grant.scope = grant.scope.filter(i => app.scope.indexOf(i) > -1);

    return MongoDB.collection('grants')
    .update(
      {id: grant.id},
      {$set: grant}
    );

  });

}

/**
 * Given an application id, this function simply returns the same id if that id
 * is already unique. If not, a unique id is created based on the original id
 * and returned.
 *
 * @param {String} id
 * @return {Promise} Promise providing a unique id
 */
function convertToUniqueid(id) {

  return MongoDB.collection('applications')
  .find(
    {id: {$regex: '^'.concat(id)}},
    {_id: 0, id: 1}
  )
  .toArray()
  .then((apps) => {

    const ids = apps.map(app => app.id);
    let uniqueId = id,
      isUniqueId = ids.indexOf(uniqueId) === -1,
      postfixNumber = 0;

    while (!isUniqueId) {
      uniqueId = id.concat('-', ++postfixNumber);
      isUniqueId = !ids.includes(uniqueId);
    }

    return uniqueId.replace(' ', '_');

  });

}


/**
 * Removes duplicate values from the given array
 *
 * Notice that non-array values simply returns an empty array.
 *
 * @param {Array} input
 * @return {Array} Array with unique values only
 */
function makeArrayUnique(input) {
  return Array.isArray(input) ? [ ...new Set(input) ] : [ ]; // The ES6-way :-)
}
