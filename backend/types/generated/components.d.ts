import type { Schema, Struct } from '@strapi/strapi';

export interface CourseModule extends Struct.ComponentSchema {
  collectionName: 'components_course_modules';
  info: {
    displayName: 'Module';
  };
  attributes: {
    duration_minutes: Schema.Attribute.Integer & Schema.Attribute.Required;
    mark_as_read: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    module_content_type: Schema.Attribute.Enumeration<
      ['Video', 'Pdf', 'Scorm', 'Text']
    > &
      Schema.Attribute.Required;
    order: Schema.Attribute.Integer & Schema.Attribute.Required;
    pdf_file: Schema.Attribute.Media<
      'images' | 'videos' | 'files' | 'audios',
      true
    >;
    text_content: Schema.Attribute.Blocks;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    video_file: Schema.Attribute.Media<
      'images' | 'videos' | 'files' | 'audios',
      true
    >;
  };
}

export interface QuizChecklist extends Struct.ComponentSchema {
  collectionName: 'components_quiz_checklists';
  info: {
    displayName: 'Checklist';
  };
  attributes: {
    discription: Schema.Attribute.Text;
  };
}

export interface QuizOptions extends Struct.ComponentSchema {
  collectionName: 'components_quiz_options';
  info: {
    displayName: 'Quiz question options';
  };
  attributes: {
    option_key: Schema.Attribute.String & Schema.Attribute.Required;
    option_label: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface QuizQuestion extends Struct.ComponentSchema {
  collectionName: 'components_quiz_questions';
  info: {
    displayName: 'Question';
  };
  attributes: {
    options: Schema.Attribute.Component<'quiz.options', true>;
    order: Schema.Attribute.Integer;
    points: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<1>;
    question_text: Schema.Attribute.Text & Schema.Attribute.Required;
    question_type: Schema.Attribute.Enumeration<
      ['Multiple_choice', 'True_false', 'Multiple_select']
    > &
      Schema.Attribute.Required;
  };
}

export interface QuizQuizInstruction extends Struct.ComponentSchema {
  collectionName: 'components_quiz_quiz_instructions';
  info: {
    displayName: 'Quiz instruction';
  };
  attributes: {
    description: Schema.Attribute.Text;
    name: Schema.Attribute.String;
  };
}

export interface SharedMedia extends Struct.ComponentSchema {
  collectionName: 'components_shared_media';
  info: {
    displayName: 'Media';
    icon: 'file-video';
  };
  attributes: {
    file: Schema.Attribute.Media<'images' | 'files' | 'videos'>;
  };
}

export interface SharedQuote extends Struct.ComponentSchema {
  collectionName: 'components_shared_quotes';
  info: {
    displayName: 'Quote';
    icon: 'indent';
  };
  attributes: {
    body: Schema.Attribute.Text;
    title: Schema.Attribute.String;
  };
}

export interface SharedRichText extends Struct.ComponentSchema {
  collectionName: 'components_shared_rich_texts';
  info: {
    description: '';
    displayName: 'Rich text';
    icon: 'align-justify';
  };
  attributes: {
    body: Schema.Attribute.RichText;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: '';
    displayName: 'Seo';
    icon: 'allergies';
    name: 'Seo';
  };
  attributes: {
    metaDescription: Schema.Attribute.Text & Schema.Attribute.Required;
    metaTitle: Schema.Attribute.String & Schema.Attribute.Required;
    shareImage: Schema.Attribute.Media<'images'>;
  };
}

export interface SharedSlider extends Struct.ComponentSchema {
  collectionName: 'components_shared_sliders';
  info: {
    description: '';
    displayName: 'Slider';
    icon: 'address-book';
  };
  attributes: {
    files: Schema.Attribute.Media<'images', true>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'course.module': CourseModule;
      'quiz.checklist': QuizChecklist;
      'quiz.options': QuizOptions;
      'quiz.question': QuizQuestion;
      'quiz.quiz-instruction': QuizQuizInstruction;
      'shared.media': SharedMedia;
      'shared.quote': SharedQuote;
      'shared.rich-text': SharedRichText;
      'shared.seo': SharedSeo;
      'shared.slider': SharedSlider;
    }
  }
}
