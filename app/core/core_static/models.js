
/**
 * Base class for nested models, uses the scheme described here:
 * http://stackoverflow.com/questions/6535948/nested-models-in-backbone-js-how-to-approach
 */
App.NestedModel = Backbone.Model.extend({
    attributeModels: {},
    parse: function (response) {
        App.debug("Parsing nested model");
        for (var key in this.attributeModels) {
            var subModel = this.attributeModels[key];
            var subData = response[key];
            response[key] = new subModel(subData, {parse: true})
            // Notify children that they have been updated
            response[key].trigger('parentSync');
        }
        App.debug(response);
        return response;
    }
});

App.QueryParamMixin = {

    _getWildcardedParam: function(paramName){
        var raw = this.params.get(paramName);
        var value = ( (raw===undefined) || (raw.length==0) ) ? '*' : raw;
        return encodeURIComponent(value);
    },

    _getStartParam: function(){
        return this._getWildcardedParam('start');
    },

    _getEndParam: function(){
        return this._getWildcardedParam('end');
    },

    _getDateParamUrlParts: function(){
        return [ this._getStartParam(), this._getEndParam() ];
    },

    _getKeywords: function(){   // wrapper to handle empty keywords field, call this instead of this.params.get('keywords')
        var kw = this.params.get('keywords');
        if (kw.length == 0) {
            kw = " ";
        }
        return kw;
    },

    getQueryParamUrl: function(){
        var kw = this._getKeywords();
        var urlParts = [ 
            encodeURIComponent(kw),
            encodeURIComponent(JSON.stringify(this.params.get('mediaModel').queryParam()))
        ].concat( this._getDateParamUrlParts() );
        return urlParts.join('/');
    }

};

/**
 * If you model queries the server with query params, use this base class
 */
App.QueryParamDrivenCollection = Backbone.Collection.extend(App.QueryParamMixin);

/* Mix in to a Collection to add:
 * getDeferred(id, [context])
 *   Return a Deferred which resolves to the model with the given id.
*/
App.DeferredCollectionMixin = {
    getDeferred: function (id, context) {
        App.debug('App.DeferredCollectionMixin.getDeferred()');
        App.debug(id);
        var that = this;
        ids = []
        if (typeof(id.length) === 'undefined') {
            ids.push(id);
        } else {
            ids = id;
        }
        // allDone holds a chain of Deferreds
        // Start with already resolved placeholder
        var allDone = $.Deferred();
        allDone.resolve();
        _.each(ids, function (id) {
            var d = $.Deferred();
            // See if it's already loaded
            m = this.get(id);
            if (typeof(m) === 'undefined') {
                // Fetch asynchronously
                var idAttribute = 'id';
                if (typeof(this.model.prototype.idAttribute) !== 'undefined') {
                    idAttribute = this.model.prototype.idAttribute;
                }
                var attributes = {};
                attributes[idAttribute] = id;
                m = new this.model(
                    attributes
                );
                m.fetch({
                    success: function (m, response, options) {
                        that.add(m);
                        if (typeof(context) !== 'undefined') {
                            d.resolveWith(context, [m]);
                        } else {
                            d.resolve(m);
                        }
                    },
                    error: function (m, response, options) {
                    }
                });
            } else {
                if (typeof(context) !== 'undefined') {
                    d.resolveWith(context, [m]);
                } else {
                    d.resolve(m);
                }
            }
            allDone = $.when(d, allDone);
        }, this);
        return allDone;
    }
}

/**
 * Mixin to allow generation of unique ids.
 */
App.UidMixin = {
    nextUid: 1,
    getUid: function () {
        var uid = this.nextUid;
        this.nextUid += 1;
        return uid;
    }
};

App.UserModel = Backbone.Model.extend({
    
    id: 'user',
    urlRoot: '/api',
    defaults: {
        username: ''
        , anonymous: true
        , authenticated: false
        , error: ''
        , key: ''
        , sentencesAllowed: false
    },
    
    initialize: function () {
        App.debug('App.UserModel.initialize()')
        _.bindAll(this, 'onSync');
        _.bindAll(this, 'onSignIn');
        _.bindAll(this, 'onSignInError');
        _.bindAll(this, 'onSignOut');
        _.bindAll(this, 'signIn');
        _.bindAll(this, 'signOut');
        this.on('sync', this.onSync);
        this.on('error', this.onSignInError);
        this.set('key', Cookies.get('mediameter_user_key'));
        this.set('username', Cookies.get('mediameter_user_username'));
        this.authenticate = $.Deferred();
    },
    
    canListSentences: function(){
        return this.get('sentencesAllowed');
    },

    onSync: function () {
        App.debug('App.UserModel.onSync()');
        if (this.get('authenticated')) {
            this.onSignIn();
        } else {
            this.onSignOut();
        }
    },
    
    onSignIn: function () {
        App.debug('App.UserModel.onSignIn()');
        Cookies.set('mediameter_user_key', this.get('key'), App.config.cookieOpts);
        Cookies.set('mediameter_user_username', this.get('username'), App.config.cookieOpts);
        this.authenticate.resolve();
        this.trigger('signin');
    },
    
    onSignInError: function (model, response, options) {
        App.debug('Error signing in: ' + response.status);
        this.set('error', 'Invalid username/password');
        this.authenticate.resolve();
        if (response.status == 401) {
            this.removeCookies();
            this.trigger('unauthorized', 'Invalid username/password');
        }
    },
    
    onSignOut: function () {
        App.debug('App.UserModel.onSignOut()');
        this.trigger('signout');
    },
    
    signIn: function (options) {
        App.debug('App.UserModel.signIn()')
        that = this;
        if (typeof(route) === 'undefined') {
            route = 'home';
        }
        if (typeof(options.username) !== 'undefined') {
            App.debug('Signing in with username/password');
            this.set('id', 'login');
            this.fetch({
              type: 'post',
              data: {'username': options.username, 'password': options.password},
              success: options.success,
              error: options.error
            });
        } else if (typeof(this.get('key')) !== 'undefined') {
            App.debug('Signing in with key');
            this.set('id', 'login');
            this.fetch({
              type: 'post',
              data: {'username': this.get('username'), 'key': this.get('key')},
              success: options.success,
              error: options.error
            });
        } else {
            App.debug('No key or user/pass provided');
            this.authenticate.resolve();
            if (options.error) {
                options.error();
            }
        }
    },
    
    removeCookies: function () {
        Cookies.remove('mediameter_user_key', App.config.cookieOpts);
        Cookies.remove('mediameter_user_username', App.config.cookieOpts);
    },

    signOut: function () {
        App.debug('App.UserModel.signOut()')
        var that = this;
        this.removeCookies();
        this.set('id', 'logout');
        this.set('username', '');
        this.set('authenticated', false);
        this.set('key', '');
        this.fetch({
            type: 'post'
            , error: function () {
                that.trigger('signout');
            }
        });
    }
})

App.MediaSourceModel = Backbone.Model.extend({
    idAttribute: 'media_id',
    urlRoot: '/api/media/sources/single',
    initialize: function (attributes, options) {
        this.set('type', 'media source');
    },
    isGeoTagged: function(){
        var tags = _.pluck(this.get('media_source_tags'),'tags_id');
        var tag_sets = _.pluck(this.get('media_source_tags'),'tags_sets_id');
        var isGeoTagged = _.contains(tags,8875027) || _.contains(tag_sets,556);
        return isGeoTagged;
    }
});

App.MediaSourceCollection = Backbone.Collection.extend({
    model: App.MediaSourceModel,
    url: '/api/media/sources',
    initialize: function () {
        App.debug('App.MediaSourceCollection.initialize()');
        this.nameToSource = {}
        this.on('sync', this.onSync);
        this.on('parentSync', this.onSync);
        _.bindAll(this, 'onSync');
    },
    onSync: function () {
        App.debug('App.MediaSourceCollection.onSync()');
        this.nameToSource = App.makeMap(this, 'name');
    },
    getRemoteSuggestionEngine: function () {
        App.debug('MediaSourceCollection.getRemoteSuggestionEngine()');
        if( !this.suggestRemote) {
            this.suggestRemote = new Bloodhound({
              datumTokenizer: Bloodhound.tokenizers.obj.whitespace('name'),
              queryTokenizer: Bloodhound.tokenizers.whitespace,
              remote: '/api/media/sources/search/%QUERY'
            });
            this.suggestRemote.initialize();
        }
        return this.suggestRemote;
    },
    isGeoTagged: function(){
        var isGeoTagged = true;
        this.each(function(mediaSource){
            isGeoTagged = isGeoTagged && mediaSource.isGeoTagged();
        });
        return isGeoTagged;
    }
});
App.MediaSourceCollection = App.MediaSourceCollection.extend(App.DeferredCollectionMixin);

App.SimpleTagModel = Backbone.Model.extend({
    urlRoot: '/api/media/tags/single',
    idAttribute: 'tags_id',
    initialize: function (options) {},
    getLabel: function(){
        return (this.get('label')!=null) ? this.get('label') : this.get('tag');
    },
    isGeoTagged: function(){
        var isGeoTagged = (this.get('tags_id')==8875027) || (this.get('tag_sets_id')==556);
        return isGeoTagged;
    }
});

App.SimpleTagCollection = Backbone.Collection.extend({
    model: App.SimpleTagModel,
    url: '/api/media/tags',
    initialize: function (options) {
        App.debug('App.SimpleTagCollection.initialize()');
    },
    getSuggestions: function () {
        App.debug('SimpleTagCollection.getSuggestions()');
        if (!this.suggest) {
            this.suggest = new Bloodhound({
                datumTokenizer: function (d) {
                    return Bloodhound.tokenizers.whitespace(d.name);
                },
                queryTokenizer: Bloodhound.tokenizers.whitespace,
                local: this.toJSON()
            });
            this.suggest.initialize();
        }
        return this.suggest;
    },
    getByName: function (nameToFind){
        return this.where({ name: nameToFind })[0];
    },
    getRemoteSuggestionEngine: function () {
        App.debug('SimpleTagCollection.getRemoteSuggestionEngine()');
        if( !this.suggestRemote) {
            this.suggestRemote = new Bloodhound({
              datumTokenizer: Bloodhound.tokenizers.obj.whitespace('label'),
              queryTokenizer: Bloodhound.tokenizers.whitespace,
              remote: '/api/media/tags/search/%QUERY'
            });
            this.suggestRemote.initialize();
        }
        return this.suggestRemote;
    },
    clone: function () {
        var cloneCollection = new App.SimpleTagCollection();
        this.each(function (m) {
            cloneCollection.add(m.clone());
        });
        return cloneCollection;
    },
    isGeoTagged: function(){
        var isGeoTagged = true;
        this.each(function(simpleTagModel){
            isGeoTagged = isGeoTagged && simpleTagModel.isGeoTagged();
        });
        return isGeoTagged;
    }
});
App.SimpleTagCollection = App.SimpleTagCollection.extend(App.DeferredCollectionMixin);

/**
 * This handles specifying media individually and by set.
 */
App.MediaModel = App.NestedModel.extend({
    urlRoot: '/api/media',
    attributeModels: {
        sources: App.MediaSourceCollection
        , tags: App.SimpleTagCollection
    },
    initialize: function () {
        App.debug('App.MediaModel.initialize()');
        this.syncDone = $.Deferred();
        var that = this;
        this.set('sources', new App.MediaSourceCollection());
        this.set('tags', new App.SimpleTagCollection());
        this.deferred = $.Deferred();
        this.deferred.resolve();
        this.on('sync', this.onSync, this);
        _.bindAll(this, 'onSync');
    },
    onSync: function() {
        App.debug("MediaModel.onSync");
        var that = this;
        App.debug(this);
        this.syncDone.resolve();
    },
    clone: function () {
        App.debug('App.MediaModel.clone()');
        var cloneModel = new App.MediaModel()
        this.get('sources').each(function (m) {
            cloneModel.get('sources').add(m);
        });
        cloneModel.set('tags', this.get('tags').clone());
        cloneModel.deferred.resolve();
        return cloneModel;
    },
    getDeferred: function (data) {
        // Load sources and tags according to an object like:
        // {sources:[1],sets:[2,3]}
        // Return a Deferred
        var that = this;
        allSources = {};
        allSets = {};
        if (typeof(data.length) !== undefined) {
            _.each(data, function (datum) {
                if (datum.sources) {
                    _.each(datum.sources, function (id) {
                        allSources[id] = true;
                    });
                }
                if (datum.sets) {
                    _.each(datum.sets, function (id) {
                        allSets[id] = true;
                    });
                }
            }, this);
        } else {
            if (data.sources) { allSources[data.sources] = true; }
            if (data.sets) { allSets[data.sets] = true; }
        }
        var sourcesDone = this.get('sources').getDeferred(_.keys(allSources));
        var setsDone = this.get('tags').getDeferred(_.keys(allSets));
        return $.when(sourcesDone, setsDone);
    },
    subset: function (o) {
        // Map path to model
        // Return a copy of this media model containing a subset of the
        // sources and sets according to an object like:
        // {sources:[1],sets:[4]}
        // "sources" contains media source ids. "sets" contains media tag ids.
        App.debug('App.MediaModel.subset()');
        var that = this;
        var media = new App.MediaModel();
        _.each(o.sets, function(id) {
            App.debug('  Adding set: ' + id);
            var tag = that.get('tags').get(id);
            media.get('tags').add(tag);
        });
        _.each(o.sources, function (id) {
            App.debug('  Adding source: ' + id);
            var m = that.get('sources').get(id);
            media.get('sources').add(m);
        });
        return media;
    },
    // Map model to path
    queryParam: function () {
        var qp = {}
        var sources = this.get('sources');
        if (sources && sources.length > 0) {
            qp.sources = sources.pluck('media_id');
        }
        var sets = this.get('tags');
        if (sets && sets.length > 0) {
            qp.sets = sets.pluck('tags_id');
        }
        return qp;
    },
    isDefault: function () {
        // return true if just using US MSM as the only media source
        var sources = this.get('sources');
        if(sources.length!=0) return false;
        var sets = this.get('tags');
        if(sets.length!=1) return false;
        var setIds = sets.pluck('tags_id');
        return (setIds[0]==8875027);
    },
    isGeoTagged: function() {
        return (this.get('sources').isGeoTagged() && this.get('tags').isGeoTagged());
    }
})

/** 
 * Wrapper around one set of criteria for a search (keywords, dates, media sources + sets).
 * This also handles results.
 */
App.QueryModel = Backbone.Model.extend({
    name: 'App.QueryModel',
    initialize: function (attributes, options) {
        App.debug('App.QueryModel.initialize()');
        var that = this;
        this.mediaSources = options.mediaSources
        this.subquery = options.subquery;
        // Default parameters
        if (typeof(this.get("params")) === 'undefined') {
            var dayMs = 24 * 60 * 60 * 1000;
            var ts = new Date().getTime();
            var start = new Date(ts - 15*dayMs);
            var end = new Date(ts - 1*dayMs);
            this.set("params", new Backbone.Model({
                keywords: ""
                , mediaModel: new App.MediaModel()
                , start: start.getFullYear() + '-' + (start.getMonth()+1) + '-' + start.getDate()
                , end: end.getFullYear() + '-' + (end.getMonth()+1) + '-' + end.getDate()
                , autoGeneratedName: false /* is this query using an autogenerated name? */
            }));
        }
        var opts = {
            mediaSources: this.mediaSources,
            params: this.get('params')
        };
        this.ResultModel = options.ResultModel;
        if (typeof(this.ResultModel) == 'undefined') {
            this.ResultModel = App.ResultModel;
        }
        var info = this.get('qinfo');
        if (info) {
            if (info.name) {
                this.set('name', info.name);
            }
            if (info.color) {
                this.set('color', '#'+info.color);
            }
        }
        this.set('results', new this.ResultModel({}, opts));
        this.set('queryUid', App.QueryModel.getUid());
        this.listenTo(this, 'change:name', this.onChangeName);
        this.listenTo(this, 'change:color', this.onChangeColor);
    },
    onChangeColor: function() {
        this.trigger('mm:colorchange', this);
    },
    onChangeName: function () {
        this.trigger('mm:namechange');
    },
    onChangeColor: function() {
        this.trigger('mm:colorchange', this);
    },
    getDefaultName: function() {
        return 'Query ' + this.alphaLabel(this.get('queryUid'));
    },
    hasDefaultName: function() {
        return this.getName().match(/Query [A-Z]+/);
    },
    hasAutoGeneratedName: function() {
        return this.get('autoGeneratedName');
    },
    setNameBy: function(source) {    // source = [keywords|dates]
        if(this.hasDefaultName() || this.hasAutoGeneratedName()){
            switch(source){
                case 'keywords':
                    keywords = this.get('params').get('keywords').slice(0,22);
                    if(this.get('params').get('keywords').length>22){
                        keywords = keywords+"...";
                    }
                    if(keywords.length==0) keywords = "empty";
                    this.set('name',keywords);
                    this.set('autoGeneratedName',true);
                    break;
                case 'dates':
                    this.set('name',
                        this.get('params').get('start')+" - "+this.get('params').get('end')
                    );
                    this.set('autoGeneratedName',true);
                    break;
            }
        }
    },
    getName: function() {
        var name = this.get('name');
        if (typeof(name) !== 'undefined') {
            return name;
        }
        name = this.getDefaultName();
        return name;
    },
    getColor: function () {
        var color = this.get('color');
        if (typeof(color) !== 'undefined') {
            return color;
        }
        return PrimeColor.getColorHex(this.get('queryUid') - 1);
    },
    // Convert n (>= 1) into an alpha label: A, B, .. Z, AA, AB, ...
    alphaLabel: function (n) {
        var tokens = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        var base = tokens.length;
        var label = '';
        // Determine lenth of symbol
        var d = 1;
        var dsum = base;
        while (dsum < n) {
            d += 1;
            dsum += Math.pow(base, d);
        }
        // Determine index into labels of length d
        var m = n - (dsum - Math.pow(base, d));
        // Convert to 0-based
        m -= 1;
        // Construct label
        var r;
        while (label.length < d) {
            var r = m % base;
            label = tokens[r] + label;
            m = (m - r) / base;
        }
        return label;
    },
    parse: function (response, options) {
        var attributes = _.clone(response);
        attributes.params = new Backbone.Model({
            keywords: response.keywords
            , mediaModel: response.mediaModel
            , start: response.start
            , end: response.end
        });
        var that = this;
        delete attributes.keywords;
        delete attributes.mediaModel;
        delete attributes.start;
        delete attributes.end;
        return attributes;
    },
    execute: function () {
        App.debug('App.QueryModel.execute()');
        this.get('results').fetch();
        this.trigger('model:execute', this);
    },
    getInfo: function () {
        var info = {
            "uid": this.get('queryUid')
        };
        if (this.get('name')) {
            info.name = this.get('name');
        }
        info.color = this.getColor().substr(1);
        return info;
    },
    isGeoTagged: function(){
        var sourcesOk = this.get('params').get('mediaModel').isGeoTagged();
        // now check dates
        var startDateParts = this.get('params').get('start').split("-");
        var startDate = new Date(startDateParts[0],startDateParts[1],startDateParts[2]);
        var geoTagStartDate = new Date(2015,1,1);
        var datesOk = startDate >= geoTagStartDate;
        App.debug("  QueryModel:isGeoTagged "+sourcesOk+" "+datesOk);
        return sourcesOk && datesOk;
    }
});
_.extend(App.QueryModel, App.UidMixin, App.QueryParamMixin);

/**
 * Holds a set of queries, each specifying criteria that are part of the search.
 * This handles serialization.
 */
App.QueryCollection = Backbone.Collection.extend({
    model: App.QueryModel,
    initialize: function (options) {
        // Bind listeners
        _.bindAll(this, 'mediaToAll');
        _.bindAll(this, 'dateRangeToAll');
        if (
            typeof(options) === 'undefined'
            || typeof(options.ResultModel) === 'undefined'
        ) {
            this.ResultModel = App.ResultModel;
        } else {
            this.ResultModel = options.ResultModel;
        }
        // Resource event aggregator
        this.resources = new ResourceListener();
        // Refine query event aggregator
        this.refine = _.extend({}, Backbone.Events);
        this.each(function (m) {
            this.onAdd(m, this);
        }, this);
        // Subquery event aggregators
        this.subqueryListener = _.extend({}, Backbone.Events);
        this.subqueryResources = new ResourceListener();
        // Listeners
        this.listenTo(this, 'add', this.onAdd);
        this.listenTo(this, 'remove', this.onRemove);
        this.listenTo(this.refine, 'mm:refine', this.onRefine);
        this.listenTo(this.subqueryListener, 'mm:subquery', this.onSubquery);
    },
    addQuery: function () {
        var options = {
            mediaSources: App.con.mediaSources
            , ResultModel: this.ResultModel
        };
        this.add(new App.QueryModel({}, options));
    },
    // Duplicate an existing model within the collection
    // Fires event mm:query:duplicate(newModelIndex)
    duplicate: function (model) {
        if (!this.contains(model)) {
            return;
        }
        var newMedia = model.get('params').get('mediaModel').clone();
        var attr = {
            start: model.get('params').get('start'),
            end: model.get('params').get('end'),
            keywords: model.get('params').get('keywords'),
            mediaModel: newMedia,
        };
        var opts = {
            mediaSources: model.mediaSources
            , parse: true
            , ResultModel: model.ResultModel
        };
        var newModel = new App.QueryModel(attr, opts);
        newModel.set('name', "Copy of " + model.getName());
        newModel.set('autoGeneratedName',model.get('autoGeneratedName'));
        this.add(newModel);
        var newModelIndex = this.indexOf(newModel);
        this.trigger('mm:query:duplicate', newModelIndex);
    },
    // Copy property from a model to all models in this collection
    mediaToAll: function (sourceMedia) {
        App.debug('App.QueryCollection.mediaToAll()');
        this.each(function (targetModel) {
            targetMedia = targetModel.get('params').get('mediaModel');
            targetMedia.get('sources').set(sourceMedia.get('sources').toJSON());
            targetMedia.get('tags').set(sourceMedia.get('tags').toJSON());
        });
    },
    dateRangeToAll: function (sourceModel) {
        var start = sourceModel.get('params').get('start');
        var end = sourceModel.get('params').get('end');
        this.each(function (targetModel) {
            targetModel.get('params').set('start', start);
            targetModel.get('params').set('end', end);
        });
    },
    onAdd: function (model, collection, options) {
        // When adding a QueryModel, listen to it's ResultModel
        this.resources.listen(model.get('results'));
        // Add the refine query event aggregator
        model.refine = this.refine;
        model.subqueryListener = this.subqueryListener;
    },
    onRemove: function (model, collection, options) {
        // Unlisten when we remove
        this.resources.unlisten(model.get('results'));
    },
    onRefine: function (options) {
        if('term' in options){
            this.each(function(m){
                var newKeywords = m.get('params').get('keywords');
                if(newKeywords.trim().length>0){
                    newKeywords = '(' + newKeywords + ') AND ';
                }
                newKeywords = newKeywords + options.term;
                m.get('params').set('keywords', newKeywords);
            });
        } else if( ('start' in options) && ('end' in options) ){
            this.each(function(m){
                m.get('params').set('start', options.start);
                m.get('params').set('end', options.end);
            });            
        }
        this.execute();
    },
    onSubquery: function (options) {
        var that = this;
        var q = []
        if (typeof(options.length) !== 'undefined') {
            q = options;
        } else {
            q.push(options);
        }
        // TODO expand to multiple subqueries
        var q = this.get(options.queryCid);
        var subParams = q.get('params').toJSON();
        _.extend(subParams, options.attributes);
        this.subquery = new App.QueryModel(subParams, { mediaSources: q.mediaSources, parse: true });
        this.subqueryResources.listen(this.subquery.get('results'));
        this.subquery.execute();
    },
    execute: function () {
        App.debug('App.QueryCollection.execute()');
        // Execute each Query
        this.map(function (m) { m.execute(); });
        App.debug('Trigger App.QueryCollection:execute');
        this.trigger('execute', this);
    },
    getNameList: function() {
        var allNames = this.map(function(m) { 
            if(m.get('name')){
                return m.getName();
            } else {
                return m.get('params').get('keywords');;
            }
        });
        return allNames;
    },
    keywords: function () {
        var allKeywords = this.map(
            function(m) {
                var kw = m.get('params').get('keywords');
                if (kw.length == 0) {
                    kw = " ";
                }
                return kw;
            }
        );
        return JSON.stringify(allKeywords);
    },
    start: function () {
        var allStart = this.map(function(m) { return m.get('params').get('start'); });
        return JSON.stringify(allStart);
    },
    end: function () {
        var allEnd = this.map(function(m) { return m.get('params').get('end'); });
        return JSON.stringify(allEnd);
    },
    media: function () {
        var allMedia = this.map(function (m) { return m.get('params').get('mediaModel').queryParam(); });
        return JSON.stringify(allMedia);
    },
    info: function () {
        var allInfo = this.map(function(m) { return m.getInfo(); });
        return JSON.stringify(allInfo);
    },
    dashboardUrl: function () {
        if (this.length == 0) {
            return '';
        }
        path = [
            'query'
            , this.keywords()
            , this.media()
            , this.start()
            , this.end()
            , this.info()
        ].join('/');
        return path;
    },
    dashboardDemoUrl: function () {
        return [
            'demo-query'
            , this.keywords()
            , this.media()
            , this.start()
            , this.end()
            , this.info()
        ].join('/');
    },
    alphaLabel: function (n) {
        var m;
        var tokens = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        label = '';
        while (n > 0) {
            m = n % 26;
            label += tokens[m];
            n = Math.round((m - n) / 26.0);
        }
    },
    isGeoTagged: function(){
        var allModelsAreGeoTagged = true;
        this.each(function(queryModel){
            allModelsAreGeoTagged = allModelsAreGeoTagged && queryModel.isGeoTagged();
        });
        App.debug("QueryCollection: allModelsAreGeoTagged "+allModelsAreGeoTagged);
        return allModelsAreGeoTagged;
    },
    autoNameQueries: function(){
        var autoNameByProperty = this._isAutoNameable();
        this.each(function(queryModel){
            queryModel.setNameBy(autoNameByProperty);
        });
    },
    _isAutoNameable: function(){
        // if only one query, name it by keywords
        if(this.models.length==1){
            return 'keywords';
        }
        // if media are all the same, ok to name it by keyword or date
        if(!this._allQueriesHaveSameKeywords()) return 'keywords';
        if(!this._allQueriesHaveSameDates()) return 'dates';
        //if(!this._allQueriesHaveSameMedia()) return 'media';
        return false;
    },
    _allQueriesHaveSameMedia: function(){
        var value = null;
        var ok = true;
        this.each(function(queryModel){
            queryValue = JSON.stringify(queryModel.get('params').get('mediaModel').queryParam());
            if(value == null) {
                value = queryValue;
            } else {
                if(value!=queryValue) ok = false;
            }
        });
        return ok;
    },
    _allQueriesHaveSameKeywords: function(){
        var value = null;
        var ok = true;
        this.each(function(queryModel){
            queryValue = queryModel.get('params').get('keywords');
            if(value == null) {
                value = queryValue;
            } else {
                if(value!=queryValue) ok = false;
            }
        });
        return ok;
    },
    _allQueriesHaveSameDates: function(){
        var value = null;
        var ok = true;
        this.each(function(queryModel){
            queryValue = queryModel.get('params').get('start')+"_"+queryModel.get('params').get('end');
            if(value == null) {
                value = queryValue;
            } else {
                if(value!=queryValue) ok = false;
            }
        });
        return ok;
    }
})
App.QueryCollection = App.QueryCollection.extend(App.UidMixin);

// Add this to any model that has a standard "public_date" property that we want to parse into a JS date object
App.DatedModelMixin = {
    date: function () {
        var dateString = this.get('publish_date');
        if(dateString==null){
            return "unknown date";
        }
        if (dateString.indexOf('T') >= 0) {
            dateString = dateString.substring(0, dateString.indexOf('T'));
        }
        var date;
        if(dateString.length==19){  // gotta parse this: "2014-07-12 18:32:05"
            date = new Date(
                dateString.substring(0,4), parseInt(dateString.substring(5,7))-1, dateString.substring(8,10),
                dateString.substring(11,13), dateString.substring(14,16), dateString.substring(17)
                );
        } else {
            date = new Date(dateString);    // fallback to something - will this even work?
        }
        
        return date.toLocaleDateString();
    }
}

App.SentenceModel = Backbone.Model.extend({
    initialize: function (attributes, options) {
    },
    media: function () {
        return (this.get('medium_name')==null) ? "unknown source" : this.get('medium_name');
    }
});
App.SentenceModel = App.SentenceModel.extend(App.DatedModelMixin);

App.SolrQueryModel = Backbone.Model.extend({
    initialize: function(attributes, options) {
    },
    url: function() {
        return '/api/query/solr/' + this.get('queryText');
    },
});

App.SentenceCollection = App.QueryParamDrivenCollection.extend({
    resourceType: 'sentence',
    model: App.SentenceModel,
    initialize: function (models, options) {
        this.params = options.params;
        this.mediaSources = options.mediaSources;
        this.waitForLoad = $.Deferred();
        this.on('sync', function () { this.waitForLoad.resolve(); }, this);
    },
    parse : function(response){     // a bit of a hack to save metadata
        this.totalSentences = response.total;
        this.totalStories = response.totalStories;
        App.debug("Parse sentenceCollection - "+this.totalSentences+" total");
        return response.sentences;  
    },    
    url: function () {
        return '/api/sentences/docs/' + this.getQueryParamUrl();
    },
    csvUrl: function () {
        return '/api/stories/docs/' + this.getQueryParamUrl() + '.csv';
    }
});

App.DemoSentenceCollection = App.SentenceCollection.extend({
    url: function () {
        var url = '/api/demo/sentences/docs/';
        url += encodeURIComponent(this._getKeywords());
        return url;
    }
});

App.StoryModel = Backbone.Model.extend({
    initialize: function (attributes, options) {
    },
});
App.StoryModel = App.StoryModel.extend(App.DatedModelMixin);

App.StoryCollection = App.QueryParamDrivenCollection.extend({
    resourceType: 'story',
    model: App.StoryModel,
    initialize: function (models, options) {
        this.params = options.params;
        this.mediaSources = options.mediaSources;
        this.waitForLoad = $.Deferred();
        this.on('sync', function () { this.waitForLoad.resolve(); }, this);
    },
    parse : function(response){     // a bit of a hack to save metadata
        this.totalStories = response.total;
        App.debug("Parse storyCollection - "+this.totalStories+" total");
        return response.stories;  
    },    
    url: function () {
        return '/api/stories/public/docs/' + this.getQueryParamUrl();
    },
    csvUrl: function () {
        return '/api/stories/public/docs/' + this.getQueryParamUrl() + '.csv';
    }
});

App.DemoStoryCollection = App.StoryCollection.extend({
    url: function () {
        var url = '/api/demo/stories/docs/';
        url += encodeURIComponent(this._getKeywords());
        return url;
    }
});

App.WordCountModel = Backbone.Model.extend({});
App.WordCountCollection = App.QueryParamDrivenCollection.extend({
    resourceType: 'wordcount',
    model: App.WordCountModel,
    initialize: function (models, options) {
        this.params = options.params;
    },
    url: function () {
        return '/api/wordcount/' + this.getQueryParamUrl();
    },
    csvUrl: function(){
        return '/api/wordcount/' + this.getQueryParamUrl() + '/csv';
    }
});

App.TagCountModel = Backbone.Model.extend({
    initialize: function(attributes, options){
        countryCode = ISO3166.getIdFromAlpha3(attributes['alpha3']);
        if(typeof(countryCode)!=null){ // safety against new countries
            this.set({'id':countryCode});
        }
        centroid = Centroid.fromAlpha3(attributes['alpha3']);
        if(typeof(centroid)!=null){ // safety against new countries
            this.set({'centroid':centroid});
        }
    }
});
App.TagCountCollection = App.QueryParamDrivenCollection.extend({
    resourceType: 'tagcount',
    model: App.TagCountModel,
    initialize: function (models, options) {
        this.params = options.params;
    },
    url: function () {
        return '/api/geotagcount/' + this.getQueryParamUrl();
    },
    csvUrl: function(){
        return '/api/geotagcount/' + this.getQueryParamUrl() + '.csv';
    }
});
App.DemoTagCountCollection = App.TagCountCollection.extend({
    url: function () {
        return ['/api', 'demo', 'geotagcount'
            , encodeURIComponent(this._getKeywords())
        ].join('/')
    },
    csvUrl: function(){
        return ['/api', 'demo', 'geotagcount'
            , encodeURIComponent(this._getKeywords())
        ].join('/') + ".csv"
    }
});

App.DemoWordCountCollection = App.WordCountCollection.extend({
    url: function () {
        var url = '/api/demo/wordcount/';
        url += encodeURIComponent(this._getKeywords());
        App.debug("App.DemoWordCountCollection - '"+url+"'");
        return url;
    },
    csvUrl: function(){
        return ['/api', 'demo', 'wordcount'
            , encodeURIComponent(this._getKeywords())
            , 'csv'
        ].join('/')
    }
});

App.DateCountModel = Backbone.Model.extend({
    parse: function (result) {
        var ymd = result.date.split('-');
        d = new Date(Date.UTC(ymd[0], ymd[1]-1, ymd[2]));
        result.dateObj = d;
        result.timestamp = d.getTime();
        return result;
    },
});

App.DateCountCollection = App.QueryParamDrivenCollection.extend({
    resourceType: 'datecount',
    model: App.DateCountModel,
    initialize: function (models, options) {
        this.params = options.params;
    },
    url: function () {
        return '/api/sentences/numfound/' + this.getQueryParamUrl();
    },
    csvUrl: function(){
        return '/api/sentences/numfound/' + this.getQueryParamUrl() + '/csv';
    }
});

App.DemoDateCountCollection = App.DateCountCollection.extend({
    url: function () {
        var url = '/api/demo/sentences/numfound/';
        url += encodeURIComponent(this._getKeywords());
        return url;
    },
    csvUrl: function(){
        return ['/api', 'demo', 'sentences', 'numfound'
            , encodeURIComponent(this._getKeywords())
            , 'csv'
        ].join('/')
    }
});

App.ResultModel = Backbone.Model.extend({
    children: [
        {
            "name": "wordcounts"
            , "type": App.WordCountCollection
        },
        {
            "name": "datecounts"
            , "type": App.DateCountCollection
        },
        {
            "name": "stories"
            , "type": App.StoryCollection
        },
        {
            "name": "tagcounts"
            , "type": App.TagCountCollection
        }
    ],
    initialize: function (attributes, options) {
        App.debug('App.ResultModel.initialize()');
        var that = this;
        if(App.con.userModel.canListSentences()){
            this.children[2] = {"name": "sentences", "type": App.SentenceCollection};
        } else {
            this.children[2] = {"name": "stories", "type": App.StoryCollection};
        }
        // Create children collections
        _.each(this.children, function (c) {
            this.set(c.name, new c.type([], options));
        }, this);
        // Bubble-up events sent by the individual collections
        _.each(this.children, function (c) {
            this.get(c.name).on('request', this.onRequest, this);
            this.get(c.name).on('error', this.onError, this);
            this.get(c.name).on('sync', this.onSync, this);
        }, this);
    },
    fetch: function () {
        _.each(this.children, function (c) {
            this.get(c.name).fetch();
        }, this);
    },
    onRequest: function (model_or_controller, request, options) {
        this.trigger('request', model_or_controller, request, options);
    },
    onError: function (model_or_controller, request, options) {
        this.trigger('error', model_or_controller, request, options);
    },
    onSync: function (model_or_controller, request, options) {
        this.trigger('sync', model_or_controller, request, options);
    }
});

App.DemoResultModel = App.ResultModel.extend({
    children: [
        {
            "name": "wordcounts"
            , "type": App.DemoWordCountCollection
        },
        {
            "name": "datecounts"
            , "type": App.DemoDateCountCollection
        },
        {
            "name": "tagcounts"
            , "type": App.DemoTagCountCollection
        }
    ],
    initialize: function (attributes, options) {
        App.debug('App.DemoResultModel.initialize()');
        if(App.con.userModel.canListSentences()){
            this.children.push({"name": "sentences", "type": App.DemoSentenceCollection});
        } else {
            this.children.push({"name": "stories", "type": App.DemoStoryCollection});
        }
        // Create children collections
        _.each(this.children, function (c) {
            this.set(c.name, new c.type([], options));
        }, this);
        // Bubble-up events sent by the individual collections
        _.each(this.children, function (c) {
            this.get(c.name).on('request', this.onRequest, this);
            this.get(c.name).on('error', this.onError, this);
            this.get(c.name).on('sync', this.onSync, this);
        }, this);
    }
});

App.SavedSearch = Backbone.Model.extend({
  idAttribute: 'timestamp',
  urlRoot : '/api/queries',
  getShortUrl: function(){
    return window.location.protocol+"//"+window.location.host+"/q/"+this.get('shortcode');
  }
});

App.SavedSearchCollection = Backbone.Collection.extend({
  url: '/api/queries/list',
  model: App.SavedSearch,
  initialize: function(){
  }
});
