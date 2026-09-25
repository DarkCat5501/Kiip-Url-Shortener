import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Sem isso, SIGTERM (enviado pelo Cloud Run/K8s antes de desligar uma
  // instância) nunca dispara onModuleDestroy — os buffers de links/access
  // logs pendentes no Redis ficariam presos até outra instância flushar
  app.enableShutdownHooks();

  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Aplica @Exclude()/@Expose() dos DTOs de resposta (ex: LinkResponseDto)
  // e omite campos null/undefined da resposta HTTP
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector), {
      excludeExtraneousValues: true,
      exposeUnsetFields: false,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Application running on port ${port}`);
}
await bootstrap();