'use strict';
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator['throw'](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, '__esModule', {value: true});
exports.ImageRequest = void 0;
const crypto_1 = require('crypto');
const lib_1 = require('./lib');
const thumbor_mapper_1 = require('./thumbor-mapper');

class ImageRequest {
  constructor(s3Client, secretProvider) {
    this.s3Client = s3Client;
    this.secretProvider = secretProvider;
  }
  /**
   * Initializer function for creating a new image request, used by the image handler to perform image modifications.
   * @param event Lambda request body.
   * @returns Initialized image request information.
   */
  setup(event) {
    return __awaiter(this, void 0, void 0, function* () {
      try {
        yield this.validateRequestSignature(event);
        let imageRequestInfo = {};
        imageRequestInfo.requestType = this.parseRequestType(event);
        imageRequestInfo.key = this.parseImageKey(event, imageRequestInfo.requestType);
        imageRequestInfo.bucket = this.parseImageBucket(
          event,
          imageRequestInfo.requestType,
          imageRequestInfo.key,
        );
        try {
          const imageLocation = {Bucket: imageRequestInfo.bucket, Key: imageRequestInfo.key};
          yield this.s3Client.getObject(imageLocation).promise();
        } catch {
          const originKey = imageRequestInfo.key;
          imageRequestInfo.key =
            originKey.substring(0, originKey.lastIndexOf('/') + 1) + 'default.jpg';
        }
        imageRequestInfo.edits = this.parseImageEdits(event, imageRequestInfo.requestType);
        const originalImage = yield this.getOriginalImage(
          imageRequestInfo.bucket,
          imageRequestInfo.key,
        );
        imageRequestInfo = Object.assign(Object.assign({}, imageRequestInfo), originalImage);
        imageRequestInfo.headers = this.parseImageHeaders(event, imageRequestInfo.requestType);
        // If the original image is SVG file and it has any edits but no output format, change the format to WebP.
        if (
          imageRequestInfo.contentType === 'image/svg+xml' &&
          imageRequestInfo.edits &&
          Object.keys(imageRequestInfo.edits).length > 0 &&
          !imageRequestInfo.edits.toFormat
        ) {
          imageRequestInfo.outputFormat = lib_1.ImageFormatTypes.PNG;
        }
        /* Decide the output format of the image.
         * 1) If the format is provided, the output format is the provided format.
         * 2) If headers contain "Accept: image/webp", the output format is webp.
         * 3) Use the default image format for the rest of cases.
         */
        if (
          imageRequestInfo.contentType !== 'image/svg+xml' ||
          imageRequestInfo.edits.toFormat ||
          imageRequestInfo.outputFormat
        ) {
          const outputFormat = this.getOutputFormat(event, imageRequestInfo.requestType);
          // if webp check reduction effort, if invalid value, use 4 (default in sharp)
          if (
            outputFormat === lib_1.ImageFormatTypes.WEBP &&
            imageRequestInfo.requestType === lib_1.RequestTypes.DEFAULT
          ) {
            const decoded = this.decodeRequest(event);
            if (typeof decoded.reductionEffort !== 'undefined') {
              const reductionEffort = Math.trunc(decoded.reductionEffort);
              const isValid =
                !isNaN(reductionEffort) && reductionEffort >= 0 && reductionEffort <= 6;
              imageRequestInfo.reductionEffort = isValid
                ? reductionEffort
                : ImageRequest.DEFAULT_REDUCTION_EFFORT;
            }
          }
          if (imageRequestInfo.edits && imageRequestInfo.edits.toFormat) {
            imageRequestInfo.outputFormat = imageRequestInfo.edits.toFormat;
          } else if (outputFormat) {
            imageRequestInfo.outputFormat = outputFormat;
          }
        }
        // Fix quality for Thumbor and Custom request type if outputFormat is different from quality type.
        if (imageRequestInfo.outputFormat) {
          const requestType = [lib_1.RequestTypes.CUSTOM, lib_1.RequestTypes.THUMBOR];
          const acceptedValues = [
            lib_1.ImageFormatTypes.JPEG,
            lib_1.ImageFormatTypes.PNG,
            lib_1.ImageFormatTypes.WEBP,
            lib_1.ImageFormatTypes.TIFF,
            lib_1.ImageFormatTypes.HEIF,
          ];
          imageRequestInfo.contentType = `image/${imageRequestInfo.outputFormat}`;
          if (
            requestType.includes(imageRequestInfo.requestType) &&
            acceptedValues.includes(imageRequestInfo.outputFormat)
          ) {
            const qualityKey = Object.keys(imageRequestInfo.edits).filter(key =>
              acceptedValues.includes(key),
            )[0];
            if (qualityKey && qualityKey !== imageRequestInfo.outputFormat) {
              imageRequestInfo.edits[imageRequestInfo.outputFormat] =
                imageRequestInfo.edits[qualityKey];
              delete imageRequestInfo.edits[qualityKey];
            }
          }
        }
        return imageRequestInfo;
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  }

  /**
   * Gets the original image from an Amazon S3 bucket.
   * @param bucket The name of the bucket containing the image.
   * @param key The key name corresponding to the image.
   * @returns The original image or an error.
   */
  getOriginalImage(bucket, key) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
      try {
        const result = {};
        const imageLocation = {Bucket: bucket, Key: key};
        const originalImage = yield this.s3Client.getObject(imageLocation).promise();
        const imageBuffer = Buffer.from(originalImage.Body);
        if (originalImage.ContentType) {
          // If using default S3 ContentType infer from hex headers
          if (
            ['binary/octet-stream', 'application/octet-stream'].includes(originalImage.ContentType)
          ) {
            result.contentType = this.inferImageType(imageBuffer);
          } else {
            result.contentType = originalImage.ContentType;
          }
        } else {
          result.contentType = 'image';
        }
        if (originalImage.Expires) {
          result.expires = new Date(originalImage.Expires).toUTCString();
        }
        if (originalImage.LastModified) {
          result.lastModified = new Date(originalImage.LastModified).toUTCString();
        }
        result.cacheControl =
          (_a = originalImage.CacheControl) !== null && _a !== void 0
            ? _a
            : 'max-age=31536000,public';
        result.originalImage = imageBuffer;
        return result;
      } catch (error) {
        let status = lib_1.StatusCodes.INTERNAL_SERVER_ERROR;
        let message = error.message;
        if (error.code === 'NoSuchKey') {
          status = lib_1.StatusCodes.NOT_FOUND;
          message = `The image ${key} does not exist or the request may not be base64 encoded properly.`;
        }
        throw new lib_1.ImageHandlerError(status, error.code, message);
      }
    });
  }

  /**
   * Parses the name of the appropriate Amazon S3 bucket to source the original image from.
   * @param sourceBuckets Lambda source buckets list.
   * @param targetBucket Image handler request buekct name alias.
   * @returns The name of the appropriate Amazon S3 bucket.
   */
  checkImageBucket(sourceBuckets, targetBucket) {
    const {DEFAULT_FALLBACK_IMAGE_BUCKET} = process.env;
    let find_bucket_name = DEFAULT_FALLBACK_IMAGE_BUCKET;

    sourceBuckets.forEach(currentElement => {
      if (currentElement.includes(targetBucket)) {
        find_bucket_name = currentElement;
      }
    });

    return find_bucket_name;
  }

  /**
   * Parses the name of the appropriate Amazon S3 bucket to source the original image from.
   * @param event Lambda request body.
   * @param requestType Image handler request type.
   * @param image_key Image Key
   * @returns The name of the appropriate Amazon S3 bucket.
   */
  parseImageBucket(event, requestType, image_key) {
    const sourceBuckets = this.getAllowedSourceBuckets();
    const targetBucket = image_key.split('/')[0];

    if (requestType === lib_1.RequestTypes.DEFAULT) {
      // Decode the image request
      const request = this.decodeRequest(event);
      if (request.bucket !== undefined) {
        // Check the provided bucket against the allowed list
        if (
          sourceBuckets.includes(request.bucket) ||
          request.bucket.match(new RegExp('^' + sourceBuckets[0] + '$'))
        ) {
          return request.bucket;
        } else {
          throw new lib_1.ImageHandlerError(
            lib_1.StatusCodes.FORBIDDEN,
            'ImageBucket::CannotAccessBucket',
            'The bucket you specified could not be accessed. Please check that the bucket is specified in your SOURCE_BUCKETS.',
          );
        }
      } else {
        return this.checkImageBucket(sourceBuckets, targetBucket);
      }
    } else if (
      requestType === lib_1.RequestTypes.THUMBOR ||
      requestType === lib_1.RequestTypes.CUSTOM
    ) {
      return this.checkImageBucket(sourceBuckets, targetBucket);
    } else {
      throw new lib_1.ImageHandlerError(
        lib_1.StatusCodes.NOT_FOUND,
        'ImageBucket::CannotFindBucket',
        'The bucket you specified could not be found. Please check the spelling of the bucket name in your request.',
      );
    }
  }
  /**
   * Parses the edits to be made to the original image.
   * @param event Lambda request body.
   * @param requestType Image handler request type.
   * @returns The edits to be made to the original image.
   */
  parseImageEdits(event, requestType) {
    if (requestType === lib_1.RequestTypes.DEFAULT) {
      const decoded = this.decodeRequest(event);
      return decoded.edits;
    } else if (requestType === lib_1.RequestTypes.THUMBOR) {
      const thumborMapping = new thumbor_mapper_1.ThumborMapper();
      return thumborMapping.mapPathToEdits(event.path);
    } else if (requestType === lib_1.RequestTypes.CUSTOM) {
      const thumborMapping = new thumbor_mapper_1.ThumborMapper();
      const parsedPath = thumborMapping.parseCustomPath(event.path);
      return thumborMapping.mapPathToEdits(parsedPath);
    } else {
      throw new lib_1.ImageHandlerError(
        lib_1.StatusCodes.BAD_REQUEST,
        'ImageEdits::CannotParseEdits',
        'The edits you provided could not be parsed. Please check the syntax of your request and refer to the documentation for additional guidance.',
      );
    }
  }
  /**
   * Parses the name of the appropriate Amazon S3 key corresponding to the original image.
   * @param event Lambda request body.
   * @param requestType Type of the request.
   * @returns The name of the appropriate Amazon S3 key.
   */
  parseImageKey(event, requestType) {
    if (requestType === lib_1.RequestTypes.DEFAULT) {
      // Decode the image request and return the image key
      const {key} = this.decodeRequest(event);
      return key;
    }
    if (requestType === lib_1.RequestTypes.THUMBOR || requestType === lib_1.RequestTypes.CUSTOM) {
      let {path} = event;
      if (requestType === lib_1.RequestTypes.CUSTOM) {
        const {REWRITE_MATCH_PATTERN, REWRITE_SUBSTITUTION} = process.env;
        if (typeof REWRITE_MATCH_PATTERN === 'string') {
          const patternStrings = REWRITE_MATCH_PATTERN.split('/');
          const flags = patternStrings.pop();
          const parsedPatternString = REWRITE_MATCH_PATTERN.slice(
            1,
            REWRITE_MATCH_PATTERN.length - 1 - flags.length,
          );
          const regExp = new RegExp(parsedPatternString, flags);
          path = path.replace(regExp, REWRITE_SUBSTITUTION);
        } else {
          path = path.replace(REWRITE_MATCH_PATTERN, REWRITE_SUBSTITUTION);
        }
      }
      const result_path = decodeURIComponent(
        path
          .replace(/\/\d+x\d+:\d+x\d+\/|(?<=\/)\d+x\d+\/|filters:[^/]+|\/fit-in(?=\/)|^\/+/g, '')
          .replace(/^\/+/, ''),
      );
      return decodeURIComponent(
        path
          .replace(/\/\d+x\d+:\d+x\d+\/|(?<=\/)\d+x\d+\/|filters:[^/]+|\/fit-in(?=\/)|^\/+/g, '')
          .replace(/^\/+/, ''),
      );
    }
    // Return an error for all other conditions
    throw new lib_1.ImageHandlerError(
      lib_1.StatusCodes.NOT_FOUND,
      'ImageEdits::CannotFindImage',
      'The image you specified could not be found. Please check your request syntax as well as the bucket you specified to ensure it exists.',
    );
  }
  /**
   * Determines how to handle the request being made based on the URL path prefix to the image request.
   * Categorizes a request as either "image" (uses the Sharp library), "thumbor" (uses Thumbor mapping), or "custom" (uses the rewrite function).
   * @param event Lambda request body.
   * @returns The request type.
   */
  parseRequestType(event) {
    const {path} = event;
    const matchDefault = /^(\/?)([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
    const matchThumbor =
      /^(\/?)((fit-in)?|(filters:.+\(.?\))?|(unsafe)?)(((.(?!(\.[^.\\/]+$)))*$)|.*(\.jpg$|.\.png$|\.webp$|\.tiff$|\.jpeg$|\.svg$))/i;
    const {REWRITE_MATCH_PATTERN, REWRITE_SUBSTITUTION} = process.env;
    const definedEnvironmentVariables =
      REWRITE_MATCH_PATTERN !== '' &&
      REWRITE_SUBSTITUTION !== '' &&
      REWRITE_MATCH_PATTERN !== undefined &&
      REWRITE_SUBSTITUTION !== undefined;
    // Check if path is base 64 encoded
    let isBase64Encoded = true;
    try {
      this.decodeRequest(event);
    } catch (error) {
      console.error(error);
      isBase64Encoded = false;
    }
    if (matchDefault.test(path) && isBase64Encoded) {
      // use sharp
      return lib_1.RequestTypes.DEFAULT;
    } else if (definedEnvironmentVariables) {
      // use rewrite function then thumbor mappings
      return lib_1.RequestTypes.CUSTOM;
    } else if (matchThumbor.test(path)) {
      // use thumbor mappings
      return lib_1.RequestTypes.THUMBOR;
    } else {
      throw new lib_1.ImageHandlerError(
        lib_1.StatusCodes.BAD_REQUEST,
        'RequestTypeError',
        'The type of request you are making could not be processed. Please ensure that your original image is of a supported file type (jpg, png, tiff, webp, svg) and that your image request is provided in the correct syntax. Refer to the documentation for additional guidance on forming image requests.',
      );
    }
  }
  /**
   * Parses the headers to be sent with the response.
   * @param event Lambda request body.
   * @param requestType Image handler request type.
   * @returns The headers to be sent with the response.
   */
  parseImageHeaders(event, requestType) {
    if (requestType === lib_1.RequestTypes.DEFAULT) {
      const {headers} = this.decodeRequest(event);
      if (headers) {
        return headers;
      }
    }
  }
  /**
   * Decodes the base64-encoded image request path associated with default image requests.
   * Provides error handling for invalid or undefined path values.
   * @param event Lambda request body.
   * @returns The decoded from base-64 image request.
   */
  decodeRequest(event) {
    const {path} = event;
    if (path) {
      const encoded = path.charAt(0) === '/' ? path.slice(1) : path;
      const toBuffer = Buffer.from(encoded, 'base64');
      try {
        // To support European characters, 'ascii' was removed.
        return JSON.parse(toBuffer.toString());
      } catch (error) {
        throw new lib_1.ImageHandlerError(
          lib_1.StatusCodes.BAD_REQUEST,
          'DecodeRequest::CannotDecodeRequest',
          'The image request you provided could not be decoded. Please check that your request is base64 encoded properly and refer to the documentation for additional guidance.',
        );
      }
    } else {
      throw new lib_1.ImageHandlerError(
        lib_1.StatusCodes.BAD_REQUEST,
        'DecodeRequest::CannotReadPath',
        'The URL path you provided could not be read. Please ensure that it is properly formed according to the solution documentation.',
      );
    }
  }
  /**
   * Returns a formatted image source bucket allowed list as specified in the SOURCE_BUCKETS environment variable of the image handler Lambda function.
   * Provides error handling for missing/invalid values.
   * @returns A formatted image source bucket.
   */
  getAllowedSourceBuckets() {
    const {SOURCE_BUCKETS} = process.env;

    if (SOURCE_BUCKETS === undefined) {
      throw new lib_1.ImageHandlerError(
        lib_1.StatusCodes.BAD_REQUEST,
        'GetAllowedSourceBuckets::NoSourceBuckets',
        'The SOURCE_BUCKETS variable could not be read. Please check that it is not empty and contains at least one source bucket, or multiple buckets separated by commas. Spaces can be provided between commas and bucket names, these will be automatically parsed out when decoding.',
      );
    } else {
      return SOURCE_BUCKETS.replace(/\s+/g, '').split(',');
    }
  }
  /**
   * Return the output format depending on the accepts headers and request type.
   * @param event Lambda request body.
   * @param requestType The request type.
   * @returns The output format.
   */
  getOutputFormat(event, requestType = undefined) {
    const {AUTO_WEBP} = process.env;

    const userAgent = event.headers;

    if (
      AUTO_WEBP === 'Yes' &&
      event.headers.Accept &&
      event.headers.Accept.includes('image/webp')
    ) {
      return lib_1.ImageFormatTypes.WEBP;
    } else if (requestType === lib_1.RequestTypes.DEFAULT) {
      const decoded = this.decodeRequest(event);
      return decoded.outputFormat;
    }
    return null;
  }
  /**
   * Return the output format depending on first four hex values of an image file.
   * @param imageBuffer Image buffer.
   * @returns The output format.
   */
  inferImageType(imageBuffer) {
    const imageSignature = imageBuffer.slice(0, 4).toString('hex').toUpperCase();
    switch (imageSignature) {
      case '89504E47':
        return 'image/png';
      case 'FFD8FFDB':
      case 'FFD8FFE0':
      case 'FFD8FFEE':
      case 'FFD8FFE1':
        return 'image/jpeg';
      case '52494646':
        return 'image/webp';
      case '49492A00':
        return 'image/tiff';
      case '4D4D002A':
        return 'image/tiff';
      default:
        throw new lib_1.ImageHandlerError(
          lib_1.StatusCodes.INTERNAL_SERVER_ERROR,
          'RequestTypeError',
          'The file does not have an extension and the file type could not be inferred. Please ensure that your original image is of a supported file type (jpg, png, tiff, webp, svg). Refer to the documentation for additional guidance on forming image requests.',
        );
    }
  }
  /**
   * Validates the request's signature.
   * @param event Lambda request body.
   * @returns A promise.
   * @throws Throws the error if validation is enabled and the provided signature is invalid.
   */
  validateRequestSignature(event) {
    return __awaiter(this, void 0, void 0, function* () {
      const {ENABLE_SIGNATURE, SECRETS_MANAGER, SECRET_KEY} = process.env;
      // Checks signature enabled
      if (ENABLE_SIGNATURE === 'Yes') {
        const {path, queryStringParameters} = event;
        if (
          !(queryStringParameters === null || queryStringParameters === void 0
            ? void 0
            : queryStringParameters.signature)
        ) {
          throw new lib_1.ImageHandlerError(
            lib_1.StatusCodes.BAD_REQUEST,
            'AuthorizationQueryParametersError',
            'Query-string requires the signature parameter.',
          );
        }
        try {
          const {signature} = queryStringParameters;
          const secret = JSON.parse(yield this.secretProvider.getSecret(SECRETS_MANAGER));
          const key = secret[SECRET_KEY];
          const hash = (0, crypto_1.createHmac)('sha256', key).update(path).digest('hex');
          // Signature should be made with the full path.
          if (signature !== hash) {
            throw new lib_1.ImageHandlerError(
              lib_1.StatusCodes.FORBIDDEN,
              'SignatureDoesNotMatch',
              'Signature does not match.',
            );
          }
        } catch (error) {
          if (error.code === 'SignatureDoesNotMatch') {
            throw error;
          }
          console.error('Error occurred while checking signature.', error);
          throw new lib_1.ImageHandlerError(
            lib_1.StatusCodes.INTERNAL_SERVER_ERROR,
            'SignatureValidationFailure',
            'Signature validation failed.',
          );
        }
      }
    });
  }
}
exports.ImageRequest = ImageRequest;
ImageRequest.DEFAULT_REDUCTION_EFFORT = 4;
//# sourceMappingURL=image-request.js.map
