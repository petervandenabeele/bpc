/*jshint node: true */
'use strict';


const Boom = require('boom');
const Joi = require('joi');
const OzLoadFuncs = require('./../oz_loadfuncs');
const MongoDB = require('./../mongo/mongodb_client');
const EventLog = require('./../audit/eventlog');


module.exports.register = function (server, options, next) {

  const stdCors = {
    credentials: true,
    origin: ['*'],
    headers: ['Accept', 'Authorization', 'Content-Type', 'If-None-Match'],
    exposedHeaders: ['WWW-Authenticate', 'Server-Authorization'],
    maxAge: 86400
  };

  server.route({
    method: 'POST',
    path: '/{id}',
    config: {
      auth:  {
        access: {
          scope: ['+admin:*'],
          entity: 'user' // Only superadmin users are allows to promote other superadmins
        }
      },
      cors: stdCors
    },
    handler: function(request, reply) {
      OzLoadFuncs.parseAuthorizationHeader(request.headers.authorization, function(err, ticket) {
        MongoDB.collection('grants').update(
          {
            id: request.params.id,
            app: ticket.app
          }, {
            $addToSet: { scope: 'admin:*' }
          }, function (err, result) {

            if (err) {
              EventLog.logUserEvent(
                request.params.id,
                'Scope Change Failed',
                {scope: 'admin:*', byUser: ticket.user}
              );
              return reply(err);
            }

            EventLog.logUserEvent(
              request.params.id,
              'Add Scope to User',
              {scope: 'admin:*', byUser: ticket.user}
            );

            reply({'status': 'ok'});
          }
        );
      });
    }
  });


  server.route({
    method: 'DELETE',
    path: '/{id}',
    config: {
      auth:  {
        access: {
          scope: ['+admin:*'],
          entity: 'user' // Only superadmin users are allows to demote other superadmins
        }
      },
      cors: stdCors
    },
    handler: function(request, reply) {
      OzLoadFuncs.parseAuthorizationHeader(request.headers.authorization, function (err, ticket) {

        if (err) {
          console.error(err);
          return reply(err);
        }

        if (ticket.grant === request.params.id){
          return reply(Boom.forbidden('You cannot demote yourself'));
        }

        MongoDB.collection('grants').update(
          {
            id: request.params.id,
            app: ticket.app
          }, {
            $pull: { scope: 'admin:*' }
          },
          function(err, result) {

            if (err) {
              EventLog.logUserEvent(
                request.params.id,
                'Scope Change Failed',
                {scope: 'admin:*', byUser: ticket.user}
              );
              return reply(err);
            }

            EventLog.logUserEvent(
              request.params.id,
              'Remove Scope from User',
              {scope: 'admin:*', byUser: ticket.user}
            );

            reply({'status': 'ok'});
          }
        );
      });
    }
  });



  next();

};


module.exports.register.attributes = {
  name: 'superadmin',
  version: '1.0.0'
};
