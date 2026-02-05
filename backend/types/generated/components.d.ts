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
      ['Video', 'Pdf', 'Text']
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

export interface FeedbackFormAnswer extends Struct.ComponentSchema {
  collectionName: 'components_feedback_form_answers';
  info: {
    displayName: 'Answer';
  };
  attributes: {
    answer: Schema.Attribute.String & Schema.Attribute.Required;
    answer_type: Schema.Attribute.Enumeration<
      ['Rating', 'Text', 'AgreeOrDisagree', 'YesOrNo']
    > &
      Schema.Attribute.Required;
    question: Schema.Attribute.String & Schema.Attribute.Required;
    question_id: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface FeedbackFormQuestion extends Struct.ComponentSchema {
  collectionName: 'components_feedback_form_questions';
  info: {
    displayName: 'Question';
  };
  attributes: {
    answer_type: Schema.Attribute.Enumeration<
      ['Rating', 'Text', 'AgreeOrDisagree', 'YesNo']
    > &
      Schema.Attribute.Required;
    mandatory: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    qestion: Schema.Attribute.String & Schema.Attribute.Required;
    question_id: Schema.Attribute.String & Schema.Attribute.Required;
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

export interface RoutesBusRoute extends Struct.ComponentSchema {
  collectionName: 'components_routes_bus_routes';
  info: {
    displayName: 'Bus route';
  };
  attributes: {
    route_name: Schema.Attribute.String & Schema.Attribute.Required;
    route_stops: Schema.Attribute.Component<'routes.bus-stop', true>;
  };
}

export interface RoutesBusStop extends Struct.ComponentSchema {
  collectionName: 'components_routes_bus_stops';
  info: {
    displayName: 'Bus stop';
  };
  attributes: {
    bus_sifts: Schema.Attribute.Component<'routes.sift', true> &
      Schema.Attribute.Required;
    stop_name: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface RoutesSift extends Struct.ComponentSchema {
  collectionName: 'components_routes_sifts';
  info: {
    displayName: 'Sift';
  };
  attributes: {
    sift_name: Schema.Attribute.String & Schema.Attribute.Required;
    sift_time: Schema.Attribute.Time & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'course.module': CourseModule;
      'feedback-form.answer': FeedbackFormAnswer;
      'feedback-form.question': FeedbackFormQuestion;
      'quiz.checklist': QuizChecklist;
      'quiz.options': QuizOptions;
      'quiz.question': QuizQuestion;
      'quiz.quiz-instruction': QuizQuizInstruction;
      'routes.bus-route': RoutesBusRoute;
      'routes.bus-stop': RoutesBusStop;
      'routes.sift': RoutesSift;
    }
  }
}
