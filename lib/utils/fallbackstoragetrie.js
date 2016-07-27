var MerklePatriciaTree = require("merkle-patricia-tree");
var Account = require("ethereumjs-account");
var utils = require('ethereumjs-util')
var inherits = require("util").inherits;
var Web3 = require("web3");
var to = require("./to.js");


inherits(FallbackStorageTrie, MerklePatriciaTree)

function FallbackStorageTrie(options) {
  MerklePatriciaTree.call(this);

  this.address = options.address;
  this.stateTrie = options.stateTrie || this;
  this.blockchain = options.blockchain;

  this.fallback = options.fallback;
  this.fallback_block_number = options.fallback_block_number;

  this.web3 = new Web3();
  this.web3.setProvider(new Web3.providers.HttpProvider(this.fallback));
}

FallbackStorageTrie.prototype.keyExists = function(key, callback) {
  key = utils.toBuffer(key);

  this._findPath(key, function (err, node, remainder, stack) {
    var exists = false;
    if (node && remainder.length === 0) {
      exists = true;
    }
    callback(err, exists)
  })
};

// Note: This overrides a standard method whereas the other methods do not.
FallbackStorageTrie.prototype.get = function(key, callback) {
  var self = this;

  key = utils.toBuffer(key);

  // If the account doesn't exist in our state trie, get it off the wire.
  this.keyExists(key, function(err, exists) {
    if (err) return callback(err);

    if (exists || !self.fallback) {
      MerklePatriciaTree.prototype.get.call(self, utils.toBuffer(key), callback);
    } else {
      if (self.address == null) {
        self.fetchAccount(key, function(err, account) {
          if (err) return callback(err);

          callback(null, account.serialize());
        });
      } else {
        self.web3.eth.getStorageAt(to.hex(self.address), to.hex(key), "latest", function(err, value) {
          if (err) return callback(err);
          value = utils.toBuffer(value);
          callback(null, value);
          // Store whatever we get of the wire.
          //value = utils.toBuffer(value);
          //value = utils.rlp.encode(value);

          //self.put(key, value, callback);
        });
      }
    }
  });
};

FallbackStorageTrie.prototype.getAccount = function(address, callback) {
  var self = this;

  // If the account doesn't exist in our state trie, use get it off the wire.
  this.addressExistsInTrie(address, function(err, exists, account) {
    if (err) return callback(err);

    if (exists) {
      return callback(null, account);
    } else {
      self.fetchAccount(address, callback);
    }
  });
};

FallbackStorageTrie.prototype.getCode = function(address, callback) {
  var self = this;

  this.addressExistsInTrie(address, function(err, exists) {
    if (err) return callback(err);

    if (exists) {
      self.blockchain.getCodeDirect(address, callback);
    } else {
      self.web3.eth.getCode(to.hex(address), callback);
    }
  })
};

FallbackStorageTrie.prototype.addressExistsInTrie = function(address, callback) {
  var self = this;
  this.stateTrie.get(utils.toBuffer(this.address), function(err, data) {
    if (err) return callback(err);

    var account = new Account(data);
    var json = account.toJSON(true);

    var accountExists = json.nonce != "0x" || json.balance != "0x" || json.codeHash != "0x" + utils.sha3().toString("hex");

    account.getCode(self.stateTrie, function(err, code) {
      if (err) return callback(err);

      code = "0x" + code.toString("hex");

      var codeExists = code != "0x" && code != "0x0";

      callback(null, accountExists || codeExists, account);
    });
  });
};

FallbackStorageTrie.prototype.fetchAccount = function(address, callback) {
  var address = to.hex(address);

  var self = this;
  this.web3.eth.getCode(address, function(err, code) {
    if (err) return callback(new Error("Error communicating with fallback provider: " + err.message));

    self.web3.eth.getBalance(address, function(err, balance) {
      if (err) return callback(err);

      self.web3.eth.getTransactionCount(address, function(err, nonce) {
        if (err) return callback(err);

        balance = "0x" + balance.toString(16); // BigNumber
        nonce = "0x" + self.web3.toBigNumber(nonce).toString(16);
        code = "0x" + self.web3.toBigNumber(code).toString(16);

        var account = new Account({
          nonce: nonce,
          balance: balance
        });

        account.setCode(self.stateTrie, utils.toBuffer(code), function(err) {
          if (err) return callback(err);
          callback(null, account);
        });
      });
    });
  });
};

module.exports = FallbackStorageTrie;