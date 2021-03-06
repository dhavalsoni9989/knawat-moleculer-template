import fs from 'fs';

import _ from 'lodash';
import { ActionSchema, Errors, ServiceSchema } from 'moleculer';

import pkg from '../package.json';

const { MoleculerServerError } = Errors;

/**
 * OpenAPI mixin
 *
 * @export
 * @returns {ServiceSchema}
 */
export function OpenApiMixin(): ServiceSchema {
  const mixinOptions: { schema: any; routeOptions: { path: string } } = {
    routeOptions: {
      path: '/openapi',
    },
    schema: null,
  };

  let shouldUpdateSchema = true;
  let schema: any = null;
  let schemaPrivate: any = null;

  return {
    name: 'openapi',
    events: {
      '$services.changed': function () {
        this.invalidateOpenApiSchema();
      },
    },

    methods: {
      /**
       * Invalidate the generated OpenAPI schema
       */
      invalidateOpenApiSchema() {
        shouldUpdateSchema = true;
      },

      /**
       * Write static files in not created
       */
      generateOpenApiFiles() {
        if (shouldUpdateSchema || !schema) {
          // Create new server & regenerate GraphQL schema
          this.logger.info('♻ Regenerate OpenAPI/Swagger schema...');

          schema = this.generateOpenAPISchema({ bearerOnly: true });
          schemaPrivate = this.generateOpenAPISchema({});
          shouldUpdateSchema = false;

          if (process.env.NODE_ENV !== 'production') {
            fs.writeFileSync(
              './openapi.json',
              JSON.stringify(schema, null, 4),
              'utf8'
            );

            fs.writeFileSync(
              './openapi-private.json',
              JSON.stringify(schemaPrivate, null, 4),
              'utf8'
            );
          }
        }
      },

      /**
       * Generate OpenAPI Schema
       */
      generateOpenAPISchema({ bearerOnly }: { bearerOnly: boolean }) {
        try {
          const res = _.defaultsDeep(mixinOptions.schema, {
            openapi: '3.0.3',

            // https://swagger.io/specification/#infoObject
            info: {
              title: `${pkg.name.toUpperCase()} API Documentation`,
              version: pkg.version,
              termsOfService: 'https://knawat.com/terms-and-conditions/',
              contact: {
                email: 'support@knawat.com',
                url: 'https://developer.knawat.com',
              },
              license: {
                name: `Knawat Copyright © - 2017 -  ${new Date().getFullYear()}`,
                url: 'https://knawat.com/terms-and-conditions/',
              },
              description: '',
            },

            // https://swagger.io/specification/#serverObject
            servers: [
              {
                description: 'Sandbox Server',
                url: 'https://dev.mp.knawat.io/api',
              },
              {
                description: 'Production Server',
                url: 'https://mp.knawat.io/api',
              },
            ],

            // https://swagger.io/specification/#componentsObject
            components: {
              responses: {
                UnauthorizedErrorToken: {
                  description:
                    'Access token is missing or invalid, request new one',
                },
                UnauthorizedErrorBasic: {
                  description:
                    'Authentication information is missing or invalid',
                },
                404: { description: 'Entity not found.' },
                500: {
                  description: 'Internal Error.',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Error' },
                    },
                  },
                },
              },
              securitySchemes: {
                bearerAuth: {
                  type: 'http',
                  scheme: 'bearer',
                  bearerFormat: 'JWT',
                },
                basicAuth: {
                  description:
                    'Knawat provide extra endpoint for private use, let us know if you really need access to Knawat Private APIs.',
                  type: 'http',
                  scheme: 'basic',
                },
              },
              schemas: {
                Error: {
                  type: 'object',
                  required: ['message'],
                  properties: {
                    status: {
                      type: 'string',
                    },
                    message: {
                      type: 'string',
                    },
                  },
                  description:
                    'This general error structure is used throughout this API.',
                  example: {
                    message: 'SKU(s) out of stock.',
                  },
                },
              },
            },

            // https://swagger.io/specification/#pathsObject
            paths: {},

            // https://swagger.io/specification/#securityRequirementObject
            security: [],

            // https://swagger.io/specification/#tagObject
            tags: [],

            // https://swagger.io/specification/#externalDocumentationObject
            externalDocs: {
              description: 'Find more info here',
              url: 'https://docs.knawat.io',
            },
          });

          const services = this.broker.registry.getServiceList({
            withActions: true,
          });
          services.forEach((service: any) => {
            // --- COMPILE SERVICE-LEVEL DEFINITIONS ---
            if (service.settings.openapi) {
              _.merge(res, service.settings.openapi);
            }

            // --- COMPILE ACTION-LEVEL DEFINITIONS ---
            _.forIn(service.actions, (action: ActionSchema) => {
              if (!action.openapi && !_.isObject(action.openapi)) {
                return;
              }

              // Hide basic endpoint
              if (
                bearerOnly &&
                action.openapi?.security?.length &&
                !action.openapi?.security.some(
                  (security: { [key: string]: string }) => security.bearerAuth
                )
              ) {
                return;
              }

              // console.log(action.openapi.security[0].bearerAuth);
              const def: any = _.cloneDeep(action.openapi);
              if (def?.length > 0) {
                def.forEach((defElement: any) => {
                  let method: any;
                  let routePath: any;
                  if (defElement.$path) {
                    const path: string = defElement.$path.split(' ');
                    method = path[0].toLowerCase();
                    routePath = path[1];
                    delete defElement.$path;
                  }

                  _.set(res.paths, [routePath, method], defElement);
                });
              } else {
                let method: any;
                let routePath: any;
                if (def.$path) {
                  const path = def.$path.split(' ');
                  method = path[0].toLowerCase();
                  routePath = path[1];
                  delete def.$path;
                }

                _.set(res.paths, [routePath, method], def);
              }
            });
          });

          return res;
        } catch (err) {
          throw new MoleculerServerError(
            'Unable to compile OpenAPI schema',
            500,
            'UNABLE_COMPILE_OPENAPI_SCHEMA',
            { err }
          );
        }
      },
    },

    created() {
      const route = _.defaultsDeep(mixinOptions.routeOptions, {
        path: '/openapi',
        // Set CORS headers
        cors: {
          // Configures the Access-Control-Allow-Origin CORS header.
          origin: '*',
          // Configures the Access-Control-Allow-Methods CORS header.
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
          // Configures the Access-Control-Allow-Headers CORS header.
          allowedHeaders: [
            '*',
            'Origin',
            'X-Requested-With',
            'Content-Type',
            'Accept',
            'Authorization',
            'Access-Control-Allow-*',
          ],
          // Configures the Access-Control-Expose-Headers CORS header.
          exposedHeaders: [],
          // Configures the Access-Control-Allow-Credentials CORS header.
          credentials: true,
          // Configures the Access-Control-Max-Age CORS header.
          maxAge: 3600,
        },

        aliases: {
          'GET /openapi.json': function (req: any, res: any) {
            // Regenerate static files
            this.generateOpenApiFiles();

            const ctx = req.$ctx;
            ctx.meta.responseType = 'application/json';

            return this.sendResponse(req, res, schema);
          },
          'GET /openapi-private.json': [
            (req: any, res: any) => {
              const auth = { login: 'your-login', password: 'your-password' };

              // parse login and password from headers
              const b64auth =
                (req?.headers?.authorization || '').split(' ')[1] || '';
              const [login, password] = Buffer.from(b64auth, 'base64')
                .toString()
                .split(':');

              const ctx = req.$ctx;

              // Verify login and password are set and correct
              if (
                login &&
                password &&
                login === auth.login &&
                password === auth.password
              ) {
                // Regenerate static files
                this.generateOpenApiFiles();

                ctx.meta.responseType = 'application/json';

                return this.sendResponse(req, res, schemaPrivate);
              }

              // Access denied...
              ctx.meta.$responseHeaders = {
                'WWW-Authenticate': 'Basic realm="401"',
              };
              ctx.meta.$statusCode = 401;

              return this.sendResponse(req, res, 'Authentication required');
            },
          ],
        },

        mappingPolicy: 'restrict',
      });

      // Add route
      this.settings.routes.unshift(route);
    },

    started() {
      return this.logger.info(
        `📜 OpenAPI Docs server is available at ${mixinOptions.routeOptions.path}`
      );
    },
  };
}
