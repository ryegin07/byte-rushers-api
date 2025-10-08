import {BootMixin} from '@loopback/boot';
import {ApplicationConfig} from '@loopback/core';
import {
  RestExplorerBindings,
  RestExplorerComponent,
} from '@loopback/rest-explorer';
import {RepositoryMixin} from '@loopback/repository';
import {RestApplication} from '@loopback/rest';
import {ServiceMixin} from '@loopback/service-proxy';
import path from 'path';
import {MySequence} from './sequence';
import {corsMiddleware} from './middleware/cors.middleware';
import {CounterService} from './services/counter.service';
import {PublisherObserver} from './observers/publisher.observer';
import {MailerService} from './services/mailer.service';
import {SmsService} from './services/sms.service';

export {ApplicationConfig};

export class LoopbackApiApplication extends BootMixin(
  ServiceMixin(RepositoryMixin(RestApplication)),
) {
  constructor(options: ApplicationConfig = {}) {
    super(options);

    // Set up the custom sequence
    this.sequence(MySequence);

    // Set up default home page
    this.static('/', path.join(__dirname, '../public'));

    // Explorer
    this.bind(RestExplorerBindings.CONFIG).to({
      path: '/explorer',
    });
    this.component(RestExplorerComponent);

    // CORS middleware
    this.middleware(corsMiddleware);

    this.projectRoot = __dirname;

    // Bind services and observer
    this.service(CounterService);
    this.service(MailerService);
    this.service(SmsService);
    this.lifeCycleObserver(PublisherObserver);

    // Boot options
    this.bootOptions = {
      controllers: {
        dirs: ['controllers'],
        extensions: ['.controller.js'],
        nested: true,
      },
    };
  }
}
