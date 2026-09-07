import { Body, Controller, Header, Inject, Post, Res, ServiceUnavailableException } from '@nestjs/common';

import { AuditEmissionUnavailableError } from '../../application/audit/audit-emission-unavailable-error';
import { DemoLoginService, type DemoLoginResult } from '../../application/authentication/demo-login.service';

interface DemoLoginHttpResponse {
  status(statusCode: number): { json(body: DemoLoginResult): void };
}

@Controller('demo/auth')
export class DemoAuthController {
  constructor(@Inject(DemoLoginService) private readonly loginService: DemoLoginService) {}

  @Post('login')
  @Header('Cache-Control', 'no-store')
  login(@Body() body: unknown, @Res() response: DemoLoginHttpResponse): void {
    try {
      const result = this.loginService.login(body);
      response.status(result.authenticated ? 200 : 401).json(result);
    } catch (error) {
      if (error instanceof AuditEmissionUnavailableError) {
        throw new ServiceUnavailableException({ authenticated: false, message: 'Audit emission unavailable' });
      }
      throw error;
    }
  }
}
