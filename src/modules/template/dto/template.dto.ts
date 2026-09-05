import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

const NAME_MAX_LENGTH = 100;
const BODY_MAX_LENGTH = 4096;
const HEADER_FOOTER_MAX_LENGTH = 1024;

export class CreateTemplateDto {
  @ApiProperty({
    description: 'Unique template name within the session',
    example: 'order-confirmation',
    maxLength: NAME_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({
    description: 'Template body with {{variable}} placeholders',
    example: 'Hi {{customer}}, your order {{orderId}} has shipped.',
    maxLength: BODY_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BODY_MAX_LENGTH)
  body!: string;

  @ApiPropertyOptional({
    description: 'Optional header text, prepended to the rendered body',
    example: 'OpenWA Store',
    maxLength: HEADER_FOOTER_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(HEADER_FOOTER_MAX_LENGTH)
  header?: string;

  @ApiPropertyOptional({
    description: 'Optional footer text, appended to the rendered body',
    example: 'Reply STOP to unsubscribe.',
    maxLength: HEADER_FOOTER_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(HEADER_FOOTER_MAX_LENGTH)
  footer?: string;

  // Flexible media — like Message Tester: image+text, file+text (not bulk)
  @ApiPropertyOptional({ description: 'Media type: text|image|video|audio|document', example: 'image' })
  @IsOptional()
  @IsString()
  mediaType?: string;

  @ApiPropertyOptional({ description: 'Media URL (https or Supabase public URL)', example: 'https://...' })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({ description: 'Base64 media (fallback when Supabase not configured)' })
  @IsOptional()
  @IsString()
  mediaBase64?: string;

  @ApiPropertyOptional({ description: 'Mimetype for base64 media', example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  mimetype?: string;

  @ApiPropertyOptional({ description: 'Filename for document', example: 'offer.pdf' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ description: 'Caption for media (supports {{vars}})', example: 'Hi {{name}} see this' })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({ description: 'Supabase storage path', example: 'templates/abc.jpg' })
  @IsOptional()
  @IsString()
  supabasePath?: string;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional({ description: 'Template name', maxLength: NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ description: 'Template body with {{variable}} placeholders', maxLength: BODY_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BODY_MAX_LENGTH)
  body?: string;

  @ApiPropertyOptional({ description: 'Optional header text', maxLength: HEADER_FOOTER_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(HEADER_FOOTER_MAX_LENGTH)
  header?: string;

  @ApiPropertyOptional({ description: 'Optional footer text', maxLength: HEADER_FOOTER_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(HEADER_FOOTER_MAX_LENGTH)
  footer?: string;

  @ApiPropertyOptional({ description: 'Media type: text|image|video|audio|document' })
  @IsOptional()
  @IsString()
  mediaType?: string;

  @ApiPropertyOptional({ description: 'Media URL' })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({ description: 'Base64 media' })
  @IsOptional()
  @IsString()
  mediaBase64?: string;

  @ApiPropertyOptional({ description: 'Mimetype' })
  @IsOptional()
  @IsString()
  mimetype?: string;

  @ApiPropertyOptional({ description: 'Filename' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ description: 'Caption with {{vars}}' })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({ description: 'Supabase path' })
  @IsOptional()
  @IsString()
  supabasePath?: string;
}

export class TemplateResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sessionId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  body!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  header?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  footer?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  mediaType?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  mediaUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  mimetype?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  filename?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  caption?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  supabasePath?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
