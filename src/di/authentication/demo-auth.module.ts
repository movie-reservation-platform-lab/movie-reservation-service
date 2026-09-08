import { type DynamicModule, Module } from '@nestjs/common';

import type { AuthenticationAuditRecorder } from '../../application/audit/ports/authentication-audit-recorder';
import { DemoLoginService } from '../../application/authentication/demo-login.service';
import type { DemoAuthSettings } from '../../config';
import { ConstantTimeDemoCredentialVerifier } from '../../infrastructure/authentication/demo-credential-verifier';
import { DemoAuthController } from '../../presentation/http/demo-auth.controller';

@Module({})
export class DemoAuthModule {
  static forRoot(settings: DemoAuthSettings, audit: AuthenticationAuditRecorder): DynamicModule {
    if (!settings.enabled) {
      return { module: DemoAuthModule };
    }
    return {
      module: DemoAuthModule,
      controllers: [DemoAuthController],
      providers: [
        {
          provide: DemoLoginService,
          useFactory: (): DemoLoginService =>
            new DemoLoginService(new ConstantTimeDemoCredentialVerifier(settings.username, settings.password), audit),
        },
      ],
    };
  }
}
