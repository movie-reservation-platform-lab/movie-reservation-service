import { Body, Controller, Header, Inject, Post, Res } from '@nestjs/common';

import { DemoLoginService, type DemoLoginResult } from '../../application/authentication/demo-login.service';

interface DemoLoginHttpResponse {
  status(statusCode: number): { json(body: DemoLoginResult): void };
}

@Controller('demo/auth')
export class DemoAuthController {
  constructor(@Inject(DemoLoginService) private readonly loginService: DemoLoginService) {}

  @Post('login')
  @Header('Cache-Control', 'no-store')
  async login(@Body() body: unknown, @Res() response: DemoLoginHttpResponse): Promise<void> {
    const result = await this.loginService.login(body);
    response.status(result.authenticated ? 200 : 401).json(result);
  }
}
