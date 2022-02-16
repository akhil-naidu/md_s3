'use strict';

const eejs = require('md_mudoc-lite/node/eejs/');
const settings = require('md_mudoc-lite/node/utils/Settings');
const Busboy = require('busboy');
const StreamUpload = require('stream_upload');
const uuid = require('uuid');
const path = require('path');
const mimetypes = require('mime-db');
const url = require('url');
const fs = require('fs');

/**
 * ClientVars hook
 *
 * Exposes plugin settings from settings.json to client code inside clientVars variable
 * to be accessed from client side hooks
 *
 * @param {string} hookName Hook name ("clientVars").
 * @param {object} args Object containing the arguments passed to hook. {pad: {object}}
 * @param {function} cb Callback
 *
 * @returns {*} callback
 *
 *
 */
exports.clientVars = (hookName, args, cb) => {
  const pluginSettings = {
    storageType: 'base64',
  };
  if (!settings.md_s3) {
    settings.md_s3 = {};
  }
  const keys = Object.keys(settings.md_s3);
  keys.forEach((key) => {
    if (key !== 'storage') {
      pluginSettings[key] = settings.md_s3[key];
    }
  });
  if (settings.md_s3.storage && settings.md_s3.storage.type !== 'base64') {
    pluginSettings.storageType = settings.md_s3.storage.type;
  }

  if (!pluginSettings) {
    console.warn(hookName,
        'md_s3 settings not found. The settings can be specified in EP settings.json.'
    );

    return cb();
  }
  pluginSettings.mimeTypes = mimetypes;

  return cb({md_s3: pluginSettings});
};

exports.eejsBlock_body = (hookName, args, cb) => {
  const modal = eejs.require('md_s3/templates/modal.ejs');
  args.content += modal;

  return cb();
};

const drainStream = (stream) => {
  stream.on('readable', stream.read.bind(stream));
};

exports.expressConfigure = (hookName, context) => {
  context.app.post('/p/:padId/pluginfw/md_s3/upload', (req, res, next) => {
    const padId = req.params.padId;
    let busboy;
    const imageUpload = new StreamUpload({
      extensions: settings.md_s3.fileTypes,
      maxSize: settings.md_s3.maxFileSize,
      baseFolder: settings.md_s3.storage.baseFolder,
      storage: settings.md_s3.storage,
    });
    const storageConfig = settings.md_s3.storage;
    if (storageConfig) {
      try {
        busboy = new Busboy({
          headers: req.headers,
          limits: {
            fileSize: settings.md_s3.maxFileSize,
          },
        });
      } catch (error) {
        console.error('md_s3 ERROR', error);

        return next(error);
      }

      let isDone;
      const done = (error) => {
        if (error) {
          console.error('md_s3 UPLOAD ERROR', error);

          return;
        }

        if (isDone) return;
        isDone = true;

        res.status(error.statusCode || 500).json(error);
        req.unpipe(busboy);
        drainStream(req);
        busboy.removeAllListeners();
      };

      let uploadResult;
      const newFileName = uuid.v4();
      let accessPath = '';
      busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
        let savedFilename = path.join(padId, newFileName + path.extname(filename));

        if (settings.md_s3.storage && settings.md_s3.storage.type === 'local') {
          let baseURL = settings.md_s3.storage.baseURL;
          if (baseURL.charAt(baseURL.length - 1) !== '/') {
            baseURL += '/';
          }
          accessPath = new url.URL(savedFilename, settings.md_s3.storage.baseURL);
          savedFilename = path.join(settings.md_s3.storage.baseFolder, savedFilename);
        }
        file.on('limit', () => {
          const error = new Error('File is too large');
          error.type = 'fileSize';
          error.statusCode = 403;
          busboy.emit('error', error);
          imageUpload.deletePartials();
        });
        file.on('error', (error) => {
          busboy.emit('error', error);
        });

        uploadResult = imageUpload
            .upload(file, {type: mimetype, filename: savedFilename});
      });

      busboy.on('error', done);
      busboy.on('finish', () => {
        if (uploadResult) {
          uploadResult
              .then((data) => {
                if (accessPath) {
                  data = accessPath;
                }

                return res.status(201).json(data);
              })
              .catch((err) => res.status(500).json(err));
        }
      });
      req.pipe(busboy);
    }
  });
};

exports.padRemove = async (hookName, context) => {
  // If storageType is local, delete the folder for the images
  const {md_s3: {storage: {type, baseFolder} = {}} = {}} = settings;
  if (type === 'local') {
    const dir = path.join(baseFolder, context.padID);
    await fs.promises.rmdir(dir, {recursive: true});
  }
};
