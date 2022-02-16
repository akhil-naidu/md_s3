'use strict';

const eejs = require('md_mudoc-lite/node/eejs/');

exports.eejsBlock_editbarMenuLeft = (hookName, args, cb) => {
  if (args.renderContext.isReadOnly) return cb();
  // There is a way to do this with classes too using acl-write I think?
  args.content += eejs.require('md_s3/templates/editbarButton.ejs');
  return cb();
};
