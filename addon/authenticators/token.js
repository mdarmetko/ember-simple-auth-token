import Ember from 'ember';
import Base from 'simple-auth/authenticators/base';
import isSecureUrl from '../utils/is-secure-url';
import Configuration from '../configuration';

/**
  Authenticator that works with token-based authentication like JWT.

  _The factory for this authenticator is registered as
  `'simple-auth-authenticator:token'` in Ember's container._

  @class Token
  @namespace SimpleAuth.Authenticators
  @module simple-auth-token/authenticators/token
  @extends Base
*/
export default Base.extend({
  /**
    The endpoint on the server the authenticator acquires the auth token from.

    This value can be configured via
    [`SimpleAuth.Configuration.Token#serverTokenEndpoint`](#SimpleAuth-Configuration-Token-serverTokenEndpoint).

    @property serverTokenEndpoint
    @type String
    @default '/api-token-auth/'
  */
  serverTokenEndpoint: '/api-token-auth/',

  /**
    The endpoint on the server for refreshing a token.
    @property serverTokenRefreshEndpoint
    @type String
    @default '/api-token-refresh/'
  */
  serverTokenRefreshEndpoint: '/api/v1/auth-token-refresh/',

  /**
    The attribute-name that is used for the identification field when sending the
    authentication data to the server.

    This value can be configured via
    [`SimpleAuth.Configuration.Token#identificationField`](#SimpleAuth-Configuration-Token-identificationField).

    @property identificationField
    @type String
    @default 'username'
  */
  identificationField: 'username',

  /**
    The name of the property in session that contains token used for authorization.

    This value can be configured via
    [`SimpleAuth.Configuration.Token#tokenPropertyName`](#SimpleAuth-Configuration-Token-tokenPropertyName).

    @property tokenPropertyName
    @type String
    @default 'token'
  */
  tokenPropertyName: 'token',

  /**
    Sets whether the authenticator automatically refreshes access tokens.
    @property refreshAccessTokens
    @type Boolean
    @default true
  */
  refreshAccessTokens: true,

  /**
    @property _refreshTokenTimeout
    @private
  */
  _refreshTokenTimeout: null,

  /**
    @property tokenExpireName
    @type String
    @default 'exp' 
  */
  tokenExpireName: 'exp',

  /**
    @method init
    @private
  */
  init: function() {
    this.serverTokenEndpoint = Configuration.serverTokenEndpoint;
    //this.serverTokenRefreshEndpoint = Configuration.serverTokenEndpoint;
    this.identificationField = Configuration.identificationField;
    this.tokenPropertyName = Configuration.tokenPropertyName;
    //this.refreshAccessTokens = Configuration.refreshAccessTokens;
  },

  /**
    Restores the session from a set of session properties; __will return a
    resolving promise when there's a non-empty `token` in the
    `properties`__ and a rejecting promise otherwise.

    @method restore
    @param {Object} properties The properties to restore the session from
    @return {Ember.RSVP.Promise} A promise that when it resolves results in the session being authenticated
  */
  restore: function(properties) {
    var _this = this;
    return new Ember.RSVP.Promise(function(resolve, reject) {
      if (!Ember.isEmpty(properties[_this.tokenPropertyName])) {
        resolve(properties);
      } else {
        reject();
      }
    });
  },

  /**
    Authenticates the session with the specified `credentials`; the credentials
    are `POST`ed to the
    [`Authenticators.Token#serverTokenEndpoint`](#SimpleAuth-Authenticators-Token-serverTokenEndpoint)
    and if they are valid the server returns an auth token in
    response. __If the credentials are valid and authentication succeeds, a
    promise that resolves with the server's response is returned__, otherwise a
    promise that rejects with the server error is returned.

    @method authenticate
    @param {Object} options The credentials to authenticate the session with
    @return {Ember.RSVP.Promise} A promise that resolves when an auth token is successfully acquired from the server and rejects otherwise
  */
  authenticate: function(credentials) {
    var _this = this;
    return new Ember.RSVP.Promise(function(resolve, reject) {
      var data = _this.getAuthenticateData(credentials);
      _this.makeRequest(_this.serverTokenEndpoint, data).then(function(response) {
        Ember.run(function() {
          var tokenData = _this.getTokenData(response),
              expiresIn = tokenData[_this.tokenExpireName],
              expiresAt = _this.absolutizeExpirationTime(expiresIn);
          _this.scheduleAccessTokenRefresh(expiresIn, expiresAt, response.token);          
          resolve(_this.getResponseData(response));
        });
      }, function(xhr) {
        Ember.run(function() {
          reject(xhr.responseJSON || xhr.responseText);
        });
      });
    });
  },

  /**
    Returns an object used to be sent for authentication.

    @method getAuthenticateData
    @return {object} An object with properties for authentication.
  */
  getAuthenticateData: function(credentials) {
    var authentication = {
      password: credentials.password
    };
    authentication[this.identificationField] = credentials.identification;
    return authentication;
  },

  /**
    @method scheduleAccessTokenRefresh
    @private
  */
  scheduleAccessTokenRefresh: function(expiresIn, expiresAt, token) {
    if(this.refreshAccessTokens){
      var now = (new Date()).getTime(),
          wait = new Date((expiresIn * 1000) - now).getSeconds() * 1000;
      if(Ember.isEmpty(expiresAt) && !Ember.isEmpty(expiresIn)){
        expiresAt = new Date(now + expiresIn * 1000).getTime();
      }
      if(!Ember.isEmpty(token) && !Ember.isEmpty(expiresAt) && expiresAt > now){
        Ember.run.cancel(this._refreshTokenTimeout);
        delete this._refreshTokenTimeout;
        if(!Ember.testing){
          this._refreshTokenTimeout = Ember.run.later(this, this.refreshAccessToken, expiresIn, token, wait);
        }
      }
    }
  },

  /**
    @method refreshAccessToken
    @private
  */
  refreshAccessToken: function(expiresIn, token) {
    var _this = this;
    var data  = {token: token};
    return new Ember.RSVP.Promise(function(resolve, reject) {
      _this.makeRequest(_this.serverTokenRefreshEndpoint, data).then(function(response) {
        Ember.run(function() {
          var tokenData = _this.getTokenData(response);
          expiresIn = tokenData[_this.tokenExpireName] || expiresIn;
          token = tokenData[_this.tokenPropertyName] || token;
          _this.scheduleAccessTokenRefresh(expiresIn, null, token);
          resolve(response);
        });
      }, function(xhr, status, error) {
        Ember.Logger.warn('Access token could not be refreshed - server responded with ' + error + '.');
        reject();
      });
    });
  },

  /**
    Returns the decoded token with accessible returned values.

    @method getTokenData
    @return {object} An object with properties for the session.
  */
  getTokenData: function(response) {
    var token = response.token.split('.')[1];
    return JSON.parse(atob(token));
  },

  /**
    Returns an object with properties the `authenticate` promise will resolve,
    be saved in and accessible via the session.

    @method getResponseData
    @return {object} An object with properties for the session.
  */
  getResponseData: function(response) {
    return response;
  },

  /**
    Does nothing

    @method invalidate
    @return {Ember.RSVP.Promise} A resolving promise
  */
  invalidate: function() {
    return Ember.RSVP.resolve();
  },

  /**
    @method makeRequest
    @private
  */
  makeRequest: function(url, data) {
    if (!isSecureUrl(this.serverTokenEndpoint)) {
      Ember.Logger.warn('Credentials are transmitted via an insecure connection - use HTTPS to keep them secure.');
    }
    return Ember.$.ajax({
      url: url,
      type: 'POST',
      data: JSON.stringify(data),
      dataType: 'json',
      contentType: 'application/json',
      beforeSend: function(xhr, settings) {
        xhr.setRequestHeader('Accept', settings.accepts.json);
      }
    });
  },

  /**
    @method absolutizeExpirationTime
    @private
  */
  absolutizeExpirationTime: function(expiresIn) {
    if (!Ember.isEmpty(expiresIn)) {
      return new Date((new Date().getTime()) + expiresIn * 1000).getTime();
    }
  }
});
