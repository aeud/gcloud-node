/**
 * Copyright 2014 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @private
 * @module datastore/entity
 */

'use strict';

var arrify = require('arrify');
var is = require('is');

/** @const {object} Map for query operation -> operation protocol value. */
var OP_TO_OPERATOR = {
  '=':  'EQUAL',
  '>':  'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL',
  '<':  'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL',
  HAS_ANCESTOR: 'HAS_ANCESTOR'
};

/** @const {object} Conversion map for query sign -> order protocol value. */
var SIGN_TO_ORDER = {
  '-': 'DESCENDING',
  '+': 'ASCENDING'
};

/**
 * Build a Datastore Key object.
 *
 * @constructor
 * @param {object} - Configuration object.
 * @param {...*} options.path - Key path.
 * @param {string=} options.namespace - Optional namespace.
 *
 * @example
 * var key = new Key({
 *   namespace: 'ns',
 *   path: ['Company', 123]
 * });
 */
function Key(options) {
  this.namespace = options.namespace;

  if (options.path.length % 2 === 0) {
    var identifier = options.path.pop();

    if (is.number(identifier)) {
      this.id = identifier;
    } else if (is.string(identifier)) {
      this.name = identifier;
    }
  }

  this.kind = options.path.pop();

  if (options.path.length > 0) {
    this.parent = new Key(options);
  }

  // `path` is computed on demand to consider any changes that may have been
  // made to the key.
  Object.defineProperty(this, 'path', {
    enumerable: true,
    get: function() {
      return arrify(this.parent && this.parent.path)
        .concat([this.kind, this.name || this.id]);
    }
  });
}

module.exports.Key = Key;

/**
 * Build a Datastore Int object.
 *
 * @constructor
 * @param {number} val - The integer value.
 *
 * @example
 * var anInt = new Int(7);
 */
function Int(val) {
  this.val_ = val;
}

/**
 * Retrieve the Integer value.
 *
 * @return {number}
 */
Int.prototype.get = function() {
  return this.val_;
};

module.exports.Int = Int;

/**
 * Build a Datastore Double object.
 *
 * @constructor
 * @param {number} val - The double value.
 *
 * @example
 * var aDouble = new Double(7.3);
 */
function Double(val) {
  this.val_ = val;
}

/**
 * Retrieve the Double value.
 *
 * @return {number}
 */
Double.prototype.get = function() {
  return this.val_;
};

module.exports.Double = Double;

/**
 * Convert any entity protocol to a plain object.
 *
 * @todo Use registered metadata if provided.
 *
 * @param {object} proto - The protocol entity object to convert.
 * @return {object}
 *
 * @example
 * var entity = entityFromEntityProto({
 *   property: [
 *     {
 *       name: {
 *         stringValue: 'Burcu Dogan'
 *       }
 *     }
 *   ]
 * });
 *
 * // entity:
 * // {
 * //   name: 'Burcu Dogan'
 * // }
 */
function entityFromEntityProto(proto) {
  var properties = proto.property || [];
  return Object.keys(properties).reduce(function(acc, key) {
    var property = properties[key];
    acc[property.name] = propertyToValue(property.value);
    return acc;
  }, {});
}

module.exports.entityFromEntityProto = entityFromEntityProto;

/**
 * Convert a key protocol object to a Key object.
 *
 * @param {object} proto - The key protocol object to convert.
 * @return {Key}
 *
 * @example
 * var key = keyFromKeyProto({
 *   partitionId: {
 *     datasetId: 'project-id',
 *     namespace: ''
 *   },
 *   path: [
 *     {
 *       kind: 'Kind',
 *       id: '4790047639339008'
 *     }
 *   ]
 * });
 */
function keyFromKeyProto(proto) {
  var keyOptions = {
    path: []
  };

  if (proto.partition_id && proto.partition_id.namespace) {
    keyOptions.namespace = proto.partition_id.namespace;
  }

  proto.path_element.forEach(function(path, index) {
    var id = Number(path.id) || path.name;
    keyOptions.path.push(path.kind);
    if (id) {
      keyOptions.path.push(id);
    } else if (index < proto.path_element.length - 1) {
      throw new Error('Invalid key. Ancestor keys require an id or name.');
    }
  });

  return new Key(keyOptions);
}

module.exports.keyFromKeyProto = keyFromKeyProto;

/**
 * Convert a Key object to a key protocol object.
 *
 * @param {Key} key - The Key object to convert.
 * @return {object}
 *
 * @example
 * var keyProto = keyToKeyProto(new Key(['Company', 1]));
 *
 * // keyProto:
 * // {
 * //   path: [
 * //     {
 * //       kind: 'Company',
 * //       id: 1
 * //     }
 * //   ]
 * // }
 */
function keyToKeyProto(key) {
  var keyPath = key.path;
  if (!is.string(keyPath[0])) {
    throw new Error('A key should contain at least a kind.');
  }
  var path = [];
  for (var i = 0; i < keyPath.length; i += 2) {
    var p = { kind: keyPath[i] };
    var val = keyPath[i + 1];
    if (val) {
      if (is.number(val)) {
        p.id = val;
      } else {
        p.name = val;
      }
    } else if (i < keyPath.length - 2) { // i is second last path item
      throw new Error('Invalid key. Ancestor keys require an id or name.');
    }
    path.push(p);
  }
  var proto = {
    path_element: path
  };
  if (key.namespace) {
    proto.partition_id = {
      namespace: key.namespace
    };
  }
  return proto;
}

module.exports.keyToKeyProto = keyToKeyProto;

/**
 * Convert an API response array to a qualified Key and data object.
 *
 * @param {object[]} results - The response array.
 * @param {object} results.entity - An entity object.
 * @param {object} results.entity.key - The entity's key.
 * @return {object[]}
 *
 * @example
 * makeReq('runQuery', {}, function(err, response) {
 *   var entityObjects = formatArray(response.batch.entityResults);
 *
 *   // entityObjects:
 *   // {
 *   //   key: {},
 *   //   data: {
 *   //     fieldName: 'value'
 *   //   }
 *   // }
 *   //
 * });
 */
function formatArray(results) {
  return results.map(function(result) {
    return {
      key: keyFromKeyProto(result.entity.key),
      data: entityFromEntityProto(result.entity)
    };
  });
}

module.exports.formatArray = formatArray;

/**
 * Check if a key is complete.
 *
 * @param {Key} key - The Key object.
 * @return {boolean}
 *
 * @example
 * isKeyComplete(new Key(['Company', 'Google'])); // true
 * isKeyComplete(new Key('Company')); // false
 */
module.exports.isKeyComplete = function(key) {
  var proto = keyToKeyProto(key);

  for (var i = 0; i < proto.path_element.length; i++) {
    if (!proto.path_element[i].kind) {
      return false;
    }
    if (!proto.path_element[i].id && !proto.path_element[i].name) {
      return false;
    }
  }
  return true;
};

/**
 * Convert a protocol property to it's native value.
 *
 * @todo Do we need uint64s and keep Long.js support?
 *
 * @param {object} property - The property object to convert.
 * @return {*}
 *
 * @example
 * propertyToValue({
 *   boolean_value: false
 * });
 * // false
 *
 * propertyToValue({
 *   string_value: 'Hi'
 * });
 * // 'Hi'
 *
 * propertyToValue({
 *   blob_value: new Buffer('68656c6c6f')
 * });
 * // <Buffer 68 65 6c 6c 6f>
 */
function propertyToValue(property) {
  if (exists(property.integer_value)) {
    return parseInt(property.integer_value.toString(), 10);
  }
  if (exists(property.double_value)) {
    return property.double_value;
  }
  if (exists(property.string_value)) {
    return property.string_value;
  }
  if (exists(property.blob_value)) {
    return property.blob_value.toBuffer();
  }
  if (exists(property.timestamp_microseconds_value)) {
    var microSecs = parseInt(
        property.timestamp_microseconds_value.toString(), 10);
    return new Date(microSecs / 1000);
  }
  if (exists(property.key_value)) {
    return keyFromKeyProto(property.key_value);
  }
  if (exists(property.entity_value)) {
    return entityFromEntityProto(property.entity_value);
  }
  if (exists(property.boolean_value)) {
    return property.boolean_value;
  }
  if (exists(property.list_value)) {
    var list = [];
    for (var i = 0; i < property.list_value.length; i++) {
      list.push(propertyToValue(property.list_value[i]));
    }
    return list;
  }
}

module.exports.propertyToValue = propertyToValue;

/**
 * Convert any native value to a property object.
 *
 * @param {*} v - Original value.
 * @return {object}
 *
 * @example
 * valueToProperty('Hi');
 * // {
 * //   stringValue: 'Hi'
 * // }
 */
function valueToProperty(v) {
  var p = {};
  if (v instanceof Boolean || typeof v === 'boolean') {
    p.boolean_value = v;
    return p;
  }
  if (v instanceof Int) {
    p.integer_value = v.get();
    return p;
  }
  if (v instanceof Double) {
    p.double_value = v.get();
    return p;
  }
  if (v instanceof Number || typeof v === 'number') {
    if (v % 1 === 0) {
      p.integer_value = v;
    } else {
      p.double_value = v;
    }
    return p;
  }
  if (v instanceof Date) {
    p.timestamp_microseconds_value = v.getTime() * 1000;
    return p;
  }
  if (v instanceof String || typeof v === 'string') {
    p.string_value = v;
    return p;
  }
  if (v instanceof Buffer) {
    p.blob_value = v;
    return p;
  }
  if (Array.isArray(v)) {
    p.list_value = v.map(function(item) {
      return valueToProperty(item);
    });
    return p;
  }
  if (v instanceof Key) {
    p.key_value = keyToKeyProto(v);
    return p;
  }
  if (v instanceof Object && Object.keys(v).length > 0) {
    var property = [];
    Object.keys(v).forEach(function(k) {
      property.push({
        name: k,
        value: valueToProperty(v[k])
      });
    });
    p.entity_value = { property: property };
    p.indexed = false;
    return p;
  }
  throw new Error('Unsupported field value, ' + v + ', is provided.');
}

module.exports.valueToProperty = valueToProperty;

/**
 * Convert an entity object to an entity protocol object.
 *
 * @param {object} entity - The entity object to convert.
 * @return {object}
 *
 * @example
 * entityToEntityProto({
 *   name: 'Burcu',
 *   legit: true
 * });
 * // {
 * //   key: null,
 * //   property: [
 * //     {
 * //       name: 'name',
 * //       value: {
 * //         string_value: 'Burcu'
 * //       }
 * //     },
 * //     {
 * //       name: 'legit',
 * //       value: {
 * //         boolean_value: true
 * //       }
 * //     }
 * //   }
 * // }
 */
function entityToEntityProto(entity) {
  return {
    key: null,
    property: Object.keys(entity).map(function(key) {
        return {
          name: key,
          value: valueToProperty(entity[key])
        };
      })
  };
}

module.exports.entityToEntityProto = entityToEntityProto;

/**
 * Convert a query object to a query protocol object.
 *
 * @private
 *
 * @param {object} q - The query object to convert.
 * @return {object}
 *
 * @example
 * queryToQueryProto({
 *   namespace: '',
 *   kinds: [
 *     'Kind'
 *   ],
 *   filters: [],
 *   orders: [],
 *   groupByVal: [],
 *   selectVal: [],
 *   startVal: null,
 *   endVal: null,
 *   limitVal: -1,
 *   offsetVal: -1
 * });
 * // {
 * //   projection: [],
 * //   kinds: [
 * //     {
 * //       name: 'Kind'
 * //     }
 * //   ],
 * //   order: [],
 * //   groupBy: []
 * // }
 */
function queryToQueryProto(q) {
  var query = {};
  query.projection = q.selectVal.map(function(v) {
    return { property: { name: v } };
  });
  query.kind = q.kinds.map(function(k) {
    return { name: k };
  });
  // filters
  if (q.filters.length > 0) {
    var filters = q.filters.map(function(f) {
      var val = {};
      if (f.name === '__key__') {
        val.key_value = keyToKeyProto(f.val);
      } else {
        val = valueToProperty(f.val);
      }
      var property = {
        property: { name: f.name },
        operator: OP_TO_OPERATOR[f.op],
        value: val
      };
      return { property_filter: property };
    });
    query.filter = {
      composite_filter: { filter: filters, operator: 'AND' }
    };
  }
  query.order = q.orders.map(function(o) {
    return {
      property:  { name: o.name },
      direction: SIGN_TO_ORDER[o.sign]
    };
  });
  query.group_by = q.groupByVal.map(function(g) {
    return { name: g };
  });
  // pagination
  if (q.startVal) {
    query.start_cursor = new Buffer(q.startVal, 'base64');
  }
  if (q.endVal) {
    query.end_cursor = new Buffer(q.endVal, 'base64');
  }
  if (q.offsetVal > 0) {
    query.offset = q.offsetVal;
  }
  if (q.limitVal > 0) {
    query.limit = q.limitVal;
  }
  return query;
}

module.exports.queryToQueryProto = queryToQueryProto;

/**
 * Does a value exist?
 *
 * @todo If protobufjs had hasFieldname support, we wouldn't need a utility.
 *     Later address it on Protobuf.js.
 *
 * @param {*} value - Value.
 * @return {boolean}
 */
function exists(value) {
  return (value !== null && value !== undefined);
}
